import argparse
import base64
import json
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

import cv2


def post_json(url: str, payload: Dict[str, Any], api_key: str, timeout: float) -> Optional[Dict[str, Any]]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if api_key:
        req.add_header("x-api-key", api_key)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        print(f"[HTTP {e.code}] {e.reason}")
        return None
    except Exception as e:
        print(f"[ERROR] request failed: {e}")
        return None


def jpeg_b64(frame, quality: int, max_width: int) -> str:
    h, w = frame.shape[:2]
    if w > max_width:
        scale = max_width / float(w)
        frame = cv2.resize(frame, (max_width, int(h * scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("Failed to encode frame")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def main() -> None:
    parser = argparse.ArgumentParser(description="Live AI proctoring test client")
    parser.add_argument("--url", default="http://127.0.0.1:8010/analyze")
    parser.add_argument("--session-id", default="test-live-session")
    parser.add_argument("--api-key", default="")
    parser.add_argument("--interval", type=float, default=0.8, help="seconds between AI calls")
    parser.add_argument("--timeout", type=float, default=3.0)
    parser.add_argument("--camera", type=int, default=6)
    parser.add_argument("--quality", type=int, default=85)
    parser.add_argument("--max-width", type=int, default=960)
    parser.add_argument("--no-mirror", action="store_true", help="disable mirrored preview/sending")
    args = parser.parse_args()

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        raise RuntimeError("Cannot open camera")

    print("Live test started.")
    print("Press q to exit.")
    print("Expected violations: face_not_detected, multiple_faces, phone_detected, voice_detected (voice from backend audio path).")

    last_sent = 0.0
    seen_keys: Dict[str, float] = {}
    last_overlay = "starting..."
    request_count = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            print("Camera frame read failed")
            break

        now = time.time()
        mirror = not args.no_mirror
        send_frame = frame
        if mirror:
            send_frame = cv2.flip(frame, 1)

        if now - last_sent >= args.interval:
            last_sent = now
            request_count += 1
            try:
                payload = {
                    "frame": jpeg_b64(send_frame, args.quality, args.max_width),
                    "sessionId": args.session_id,
                }
                res = post_json(args.url, payload, args.api_key, args.timeout)
                if res:
                    violations: List[Dict[str, Any]] = res.get("violations", []) or []
                    ai_meta = res.get("aiMeta", {}) or {}
                    for v in violations:
                        et = str(v.get("eventType"))
                        conf = float(v.get("confidence", 0.0))
                        key = f"{et}:{round(conf,1)}"
                        cooldown_ok = now - seen_keys.get(key, 0.0) > 1.5
                        if cooldown_ok:
                            seen_keys[key] = now
                            print(
                                f"[VIOLATION] event={et} severity={v.get('severity')} conf={conf:.1f} "
                                f"trace={ai_meta.get('traceId')} source={ai_meta.get('source')} "
                                f"latencyMs={ai_meta.get('latencyMs')} stale={ai_meta.get('stale')}"
                            )

                    face = res.get("face", {}) or {}
                    last_overlay = (
                        f"face={face.get('count', 0)} detected={face.get('detected', False)} "
                        f"gaze={face.get('gazeDirection', 'na')} "
                        f"v={len(violations)}"
                    )
                    print(
                        f"[HEARTBEAT] req={request_count} faceCount={face.get('count', 0)} "
                        f"detected={face.get('detected', False)} "
                        f"violations={len(violations)} trace={ai_meta.get('traceId')}"
                    )
                else:
                    last_overlay = "AI request failed"
            except Exception as e:
                last_overlay = f"encode/send error: {e}"

        display_frame = send_frame if mirror else frame
        cv2.putText(display_frame, last_overlay, (12, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
        cv2.imshow("AI Proctor Live Test", display_frame)

        if (cv2.waitKey(1) & 0xFF) == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
