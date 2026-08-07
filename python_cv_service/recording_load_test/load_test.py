"""
Standalone recording-upload capacity test — LOAD GENERATOR half.

Pairs with server.py. Simulates N concurrent "candidates," each repeatedly
uploading a fixed-size chunk at a fixed interval (mimicking a real chunked
webcam recording), ramping concurrency up stage by stage until the success
rate drops — that's the practical ceiling for this vCPU on this workload.

Run this from a DIFFERENT machine than server.py — if both run on the same
box, the generator's own CPU usage competes with the thing being measured.

Requires: aiohttp — not in this project's venv by default, install with:
    pip install aiohttp

Usage:
    python3 load_test.py --url http://SERVER_IP:9000 \
        --start 5 --step 5 --max 100 --stage-seconds 30 \
        --chunk-mb 1.5 --interval 10
"""
import argparse
import asyncio
import base64
import os
import statistics
import time

import aiohttp


def make_chunk_b64(size_mb: float) -> str:
    raw = os.urandom(int(size_mb * 1024 * 1024))
    return base64.b64encode(raw).decode("ascii")


async def simulate_user(session, url, user_id, chunk_b64, interval, stop_event, results):
    while not stop_event.is_set():
        t0 = time.perf_counter()
        try:
            async with session.post(
                f"{url}/upload/{user_id}",
                json={"chunkData": chunk_b64},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                ok = resp.status == 200
                await resp.read()
        except Exception:
            ok = False
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        results.append((ok, elapsed_ms))
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
        except asyncio.TimeoutError:
            pass


async def run_stage(url, concurrency, duration_s, chunk_b64, interval):
    stop_event = asyncio.Event()
    results = []
    connector = aiohttp.TCPConnector(limit=0)  # no artificial client-side connection cap
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [
            asyncio.create_task(simulate_user(session, url, i, chunk_b64, interval, stop_event, results))
            for i in range(concurrency)
        ]
        await asyncio.sleep(duration_s)
        stop_event.set()
        await asyncio.gather(*tasks, return_exceptions=True)

    total = len(results)
    successes = sum(1 for ok, _ in results if ok)
    latencies = [ms for ok, ms in results if ok]
    p95 = None
    if len(latencies) >= 20:
        p95 = statistics.quantiles(latencies, n=20)[18]
    elif latencies:
        p95 = max(latencies)

    return {
        "concurrency": concurrency,
        "totalRequests": total,
        "successRate": (successes / total * 100.0) if total else 0.0,
        "avgLatencyMs": statistics.mean(latencies) if latencies else None,
        "p95LatencyMs": p95,
    }


async def main():
    parser = argparse.ArgumentParser(description="Standalone recording-upload capacity load test")
    parser.add_argument("--url", default="http://localhost:9000", help="base URL of server.py")
    parser.add_argument("--start", type=int, default=5, help="starting concurrent user count")
    parser.add_argument("--step", type=int, default=5, help="concurrency increase per stage")
    parser.add_argument("--max", type=int, default=100, help="max concurrent users to attempt")
    parser.add_argument("--stage-seconds", type=int, default=30, help="how long to hold each concurrency level")
    parser.add_argument("--chunk-mb", type=float, default=1.5, help="simulated video chunk size in MB (~30s webcam chunk)")
    parser.add_argument("--interval", type=float, default=10.0, help="seconds between each simulated user's uploads")
    parser.add_argument("--fail-threshold-pct", type=float, default=95.0, help="stop ramping once success rate drops below this")
    args = parser.parse_args()

    print(f"[SETUP] chunk size = {args.chunk_mb} MB | upload interval = {args.interval}s per user | stage length = {args.stage_seconds}s")
    chunk_b64 = make_chunk_b64(args.chunk_mb)

    concurrency = args.start
    print(f"\n{'concurrency':>12} {'requests':>10} {'success%':>10} {'avgMs':>10} {'p95Ms':>10}")
    while concurrency <= args.max:
        stage = await run_stage(args.url, concurrency, args.stage_seconds, chunk_b64, args.interval)
        avg_s = f"{stage['avgLatencyMs']:.1f}" if stage["avgLatencyMs"] is not None else "N/A"
        p95_s = f"{stage['p95LatencyMs']:.1f}" if stage["p95LatencyMs"] is not None else "N/A"
        print(f"{stage['concurrency']:>12} {stage['totalRequests']:>10} {stage['successRate']:>9.1f}% {avg_s:>10} {p95_s:>10}")

        if stage["successRate"] < args.fail_threshold_pct:
            print(f"\n[RESULT] Success rate dropped below {args.fail_threshold_pct}% at {concurrency} concurrent users.")
            print(f"[RESULT] Practical capacity ceiling for this vCPU: below {concurrency} concurrent users at "
                  f"{args.chunk_mb}MB/{args.interval}s per user.")
            return

        concurrency += args.step

    print(f"\n[RESULT] Reached max tested concurrency ({args.max}) without dropping below "
          f"{args.fail_threshold_pct}% success — real capacity is higher than this test range. Raise --max and re-run.")


if __name__ == "__main__":
    asyncio.run(main())
