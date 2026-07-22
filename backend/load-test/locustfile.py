"""
Locust load test for ONE code-exec container's supervisor.py — targets the
container directly (bypassing Redis/BullMQ/the worker process entirely),
because the question this answers is "how many concurrent candidates can
this container's slots actually sustain", not "how does the whole
application perform". Point --host at a single container's published port.

Setup:
    pip install locust

Find a container's port:
    docker port <container_name> 8000/tcp

Run with the web UI (recommended for a first look — lets you watch the
failure rate live as you raise the user count):
    locust -f locustfile.py --host http://127.0.0.1:<port>
    Then open http://localhost:8089, set "Number of users" and "Spawn
    rate" to the SAME value (e.g. 8 and 8) so every user arrives at once
    rather than ramping slowly — a slow ramp doesn't test genuine
    concurrency, it just tests one-at-a-time with extra steps.

Run the automated breaking-point sweep (headless, no browser needed —
steps concurrency up through STEP_USERS automatically, same methodology
as the manual bash-script breaking-point tests from earlier, just
repeatable and graphed):
    locust -f locustfile.py --host http://127.0.0.1:<port> --headless \
        --csv=results
    Then open results_stats_history.csv (or results.html if you add
    --html=results.html) and look at the failure-rate column jump at each
    STEP_DURATION boundary — that jump IS the breaking point.
"""
import json
from locust import HttpUser, task, between, LoadTestShape

# ==================== CONFIGURE THIS PER TEST ====================
LANGUAGE = "python"  # python | javascript | java | cpp | c
TIME_LIMIT_MS = 5000

# A trivial print() finishes in single-digit milliseconds and never
# genuinely contends for the container's shared CPU no matter how many run
# at once — that's exactly why testing with this alone gave a false "8
# slots is fine" reading earlier. CPU_BOUND is a synthetic worst case (a
# raw arithmetic loop, not something a candidate would ever actually
# submit) — useful for finding the absolute ceiling, but REALISTIC is a
# genuine exam-style solution (Sieve of Eratosthenes — sum of all primes
# up to N, read from stdin), timed at 1.28s solo on a full CPU core for
# N=5,000,000, so it's a meaningful chunk of a 5s timeLimit without being
# an extreme artificial case. Swap CODE to LIGHT for a best-case/sanity
# check, or REALISTIC for testing with something that actually resembles
# a candidate's answer.
LIGHT = "print(1+1)"
CPU_BOUND = "total = 0\nfor i in range(3000000):\n    total += i * i\nprint(total)"
REALISTIC = (
    "def sieve_sum(n):\n"
    "    is_prime = [True] * (n + 1)\n"
    "    is_prime[0] = is_prime[1] = False\n"
    "    for i in range(2, int(n**0.5) + 1):\n"
    "        if is_prime[i]:\n"
    "            for j in range(i*i, n + 1, i):\n"
    "                is_prime[j] = False\n"
    "    return sum(i for i in range(n + 1) if is_prime[i])\n"
    "\n"
    "n = int(input())\n"
    "print(sieve_sum(n))"
)
REALISTIC_INPUT = "5000000"
CODE = REALISTIC
# Must match whichever CODE is selected above — REALISTIC reads N from
# stdin via input(), LIGHT/CPU_BOUND take no input at all. Set to ""
# whenever CODE = LIGHT or CPU_BOUND.
CODE_INPUT = REALISTIC_INPUT

# Concurrency levels to step through, and how long to hold each one. Set
# to bracket where you expect the cliff — e.g. for Java, [1,2,3,4,5,6];
# for Python/JS CPU-bound, [2,3,4,5,6,7,8] mirrors the manual tests that
# found the N=4-works/N=5-fails cliff.
STEP_USERS = [2, 3, 4, 5, 6, 7, 8]
STEP_DURATION_SEC = 20

# True  = automated sweep through STEP_USERS (headless-friendly; the web
#         UI's "Number of users"/"Ramp up" fields get disabled and greyed
#         out, since the shape controls concurrency instead of you).
# False = manual control — the shape class below doesn't get defined at
#         all, so the web UI's user-count/ramp-up fields go back to being
#         normal editable inputs and you drive concurrency yourself.
ENABLE_AUTO_SHAPE = False
# ===================================================================


class CodeExecUser(HttpUser):
    # No pause between requests — each simulated user fires its next job
    # immediately after the previous one returns, for sustained pressure
    # on the container's slots. Change to between(1, 3) to simulate
    # candidates pausing between Run clicks instead of a hammering
    # benchmark.
    wait_time = between(0, 0)

    @task(20)
    def run_code(self):
        payload = {
            "language": LANGUAGE,
            "code": CODE,
            "input": CODE_INPUT,
            "timeLimitMs": TIME_LIMIT_MS,
            "memoryMb": 256,
            "pidsLimit": 64,
        }
        # catch_response=True is required: supervisor.py always answers
        # HTTP 200, even when the candidate's own code failed (TLE,
        # compile error, runtime error) — the failure is only visible in
        # the JSON body's "success" field. Without manually inspecting it
        # and calling resp.failure(), Locust would report a 100% pass
        # rate on a batch where every job timed out.
        with self.client.post(
            "/run", json=payload, catch_response=True, name=f"/run [{LANGUAGE}]"
        ) as resp:
            try:
                body = resp.json()
            except ValueError:
                resp.failure(f"non-JSON response: {resp.text[:200]}")
                return
            if body.get("success"):
                resp.success()
            else:
                resp.failure((body.get("error") or "candidate code failed")[:200])

    @task(1)
    def check_slots(self):
        # Low weight relative to run_code (1 vs 20) — this is a periodic
        # spot-check of freeSlots/maxSlots, not the thing under test.
        with self.client.get("/health", catch_response=True) as resp:
            try:
                resp.json()
            except ValueError:
                resp.failure("non-JSON /health response")
                return
            resp.success()


# Defining a LoadTestShape class at all — regardless of what it does — is
# what makes Locust disable the web UI's manual user-count/ramp-up fields,
# so the class only gets defined when ENABLE_AUTO_SHAPE is actually on.
# With it off (the default), this block doesn't run and Locust never sees
# a shape class, leaving the UI in normal manual-control mode.
if ENABLE_AUTO_SHAPE:

    class BreakingPointStepShape(LoadTestShape):
        """
        Automates the manual "fire N, measure success rate, repeat at N+1"
        breaking-point methodology: holds each concurrency level in
        STEP_USERS for STEP_DURATION_SEC, then steps to the next, then stops.
        """

        def tick(self):
            run_time = self.get_run_time()
            step = int(run_time // STEP_DURATION_SEC)
            if step >= len(STEP_USERS):
                return None  # returning None stops the test
            users = STEP_USERS[step]
            # (user_count, spawn_rate) — spawn_rate == user_count means every
            # user for this step arrives at once, not ramping in gradually.
            return (users, users)
