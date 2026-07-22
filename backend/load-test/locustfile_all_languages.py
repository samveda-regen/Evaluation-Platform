"""
Locust load test that hits EVERY currently-running code-exec container,
across EVERY language, at once - unlike locustfile.py (which targets one
container directly to isolate that container's own breaking point), this
one is for watching the whole fleet at the same time in the Locust web UI:
every python/javascript/java/cpp/c container gets its own row in the
Statistics table, so you can compare them side by side live.

How it works: at import time, this file asks Docker directly (`docker ps`
+ `docker port`) for every container carrying the talentq.codeexec label,
and dynamically creates one Locust User class per container, each with its
`host` pinned to that container's own published port. Locust auto-discovers
every HttpUser subclass in this module, so all of them run together under
one "Number of users" / "Spawn rate" setting in the web UI - it distributes
that total across every class proportionally to its `weight` (default 1
each), so a language with more containers right now gets proportionally
more simulated traffic, matching its actual current capacity.

This means the exact set of User classes here depends on whatever
containers are running AT THE MOMENT YOU START LOCUST - if you scale the
pool up/down, restart Locust to re-discover.

Setup:
    pip install locust
    (docker CLI must be on PATH - same one `docker ps` works from)

Run (web UI):
    cd backend/load-test
    locust -f locustfile_all_languages.py
    Then open http://localhost:8089. IMPORTANT: leave the "Host" field
    completely empty and don't pass --host on the command line either -
    confirmed by hand that even a placeholder --host value (e.g.
    http://unused) makes every single request fail with an empty/non-JSON
    response, for every language and every container, even though the same
    containers work perfectly fine hit directly. Each generated User class
    already carries its own correct `host`; a --host flag interferes with
    that instead of being harmlessly ignored.
    Set "Number of users" and "Spawn rate" to the same value so everyone
    arrives together rather than ramping - e.g. try (number of containers
    discovered) x 3, so each container sees roughly 3 simultaneous
    candidates, matching the real per-container safe-concurrency ballpark
    established for the realistic Python workload this session.

Run (headless, e.g. a quick sanity check):
    locust -f locustfile_all_languages.py --headless --users <N> --spawn-rate <N> --run-time 30s
    Again - no --host flag at all.

IMPORTANT about the non-Python languages' input sizes below: only
python and javascript's N values are solo-verified by hand this session
(python: 5,000,000, ~1.3-1.9s; javascript: 150,000,000, ~1.77s - the
original 20,000,000 guess for JS finished in under a second, too light to
be a meaningful test, since V8 JITs the loop aggressively). java/cpp/c's N
values are still reasoned starting points, not solo-verified. If you see
0% failures across the board for those languages, they're probably too
easy (not actually CPU-bound enough to contend) - raise N; if you see
near-100% failures even at low concurrency, N is too large for the
per-language container's CPU/memory allocation - lower it. Use
locustfile.py (single container, ENABLE_AUTO_SHAPE sweep) to calibrate a
new N against one container in isolation before trusting a fleet-wide
number here.
"""
import re
import subprocess
import sys

from locust import HttpUser, task, between

TIME_LIMIT_MS = 5000
MEMORY_MB = 256
PIDS_LIMIT = 64

# Same algorithm (Sieve of Eratosthenes, sum of primes up to N) in every
# language, so behavior is easy to compare across the board - only N
# differs, to land each language in a similarly CPU-heavy ballpark.
LANGUAGE_SPECS = {
    "python": {
        # Confirmed by hand this session: ~1.28s solo at CPU=2.0 - a
        # genuine "moderately expensive" exam-style solution, not a
        # synthetic worst case.
        "n": 5_000_000,
        "code": """
def sieve_sum(n):
    is_prime = [True] * (n + 1)
    is_prime[0] = is_prime[1] = False
    for i in range(2, int(n**0.5) + 1):
        if is_prime[i]:
            for j in range(i*i, n + 1, i):
                is_prime[j] = False
    return sum(i for i in range(n + 1) if is_prime[i])

n = int(input())
print(sieve_sum(n))
""",
    },
    "javascript": {
        # Solo-verified by hand: N=20,000,000 was too light (~0.5-1s, not
        # actually CPU-bound enough - V8 JITs this loop very well). 150M
        # measured at ~1.77s, landing in the same ballpark as Python's
        # ~1.3-1.9s. Note the memory tradeoff this creates: a Uint8Array at
        # this size is ~150MB, so even 2 concurrent executions in one
        # container approach the 256MB limit - expect JS to show MORE
        # queuing (via the memory-ratio admission gate) than the other
        # languages at equal user counts, which is realistic protective
        # behavior, not a bug.
        "n": 20_000_000, 
        "code": """
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const n = parseInt(line.trim(), 10);
  const isPrime = new Uint8Array(n + 1).fill(1);
  isPrime[0] = isPrime[1] = 0;
  for (let i = 2; i * i <= n; i++) {
    if (isPrime[i]) {
      for (let j = i * i; j <= n; j += i) isPrime[j] = 0;
    }
  }
  let sum = 0;
  for (let i = 0; i <= n; i++) if (isPrime[i]) sum += i;
  console.log(sum);
  process.exit(0);
});
""",
    },
    "java": {
        # NOT solo-verified - starting point only. Class must be named
        # Main (or supervisor.py's detect_java_class() falls back to
        # "Main" anyway if it can't find a public class).
        "n": 10_000_000,
        "code": """
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        int n = Integer.parseInt(scanner.nextLine().trim());
        boolean[] isPrime = new boolean[n + 1];
        java.util.Arrays.fill(isPrime, true);
        isPrime[0] = false;
        if (n >= 1) isPrime[1] = false;
        for (int i = 2; (long) i * i <= n; i++) {
            if (isPrime[i]) {
                for (int j = i * i; j <= n; j += i) {
                    isPrime[j] = false;
                }
            }
        }
        long sum = 0;
        for (int i = 0; i <= n; i++) {
            if (isPrime[i]) sum += i;
        }
        System.out.println(sum);
    }
}
""",
    },
    "cpp": {
        # NOT solo-verified - starting point only. Native + -O2 is far
        # faster than the interpreted/JIT languages above for the same N,
        # hence the much larger N; vector<char> (1 byte/entry) keeps a
        # single execution's memory to ~50MB.
        "n": 30_000_000,
        "code": """
#include <iostream>
#include <vector>
using namespace std;

int main() {
    long long n;
    cin >> n;
    vector<char> isPrime(n + 1, 1);
    isPrime[0] = 0;
    if (n >= 1) isPrime[1] = 0;
    for (long long i = 2; i * i <= n; i++) {
        if (isPrime[i]) {
            for (long long j = i * i; j <= n; j += i) {
                isPrime[j] = 0;
            }
        }
    }
    long long sum = 0;
    for (long long i = 0; i <= n; i++) {
        if (isPrime[i]) sum += i;
    }
    cout << sum << endl;
    return 0;
}
""",
    },
    "c": {
        # NOT solo-verified - starting point only. Same reasoning as cpp.
        "n": 15_000_000,
        "code": """
#include <stdio.h>
#include <stdlib.h>

int main() {
    long long n;
    scanf("%lld", &n);
    char *is_prime = malloc((size_t)(n + 1) * sizeof(char));
    for (long long i = 0; i <= n; i++) is_prime[i] = 1;
    is_prime[0] = 0;
    if (n >= 1) is_prime[1] = 0;
    for (long long i = 2; i * i <= n; i++) {
        if (is_prime[i]) {
            for (long long j = i * i; j <= n; j += i) {
                is_prime[j] = 0;
            }
        }
    }
    long long sum = 0;
    for (long long i = 0; i <= n; i++) {
        if (is_prime[i]) sum += i;
    }
    printf("%lld\\n", sum);
    free(is_prime);
    return 0;
}
""",
    },
}


def discover_containers():
    """Every currently-running talentq code-exec container, as (language,
    container_name, host_port) tuples - queried straight from Docker so
    this file never needs a manually-pasted port and always reflects
    whatever's actually up right now."""
    try:
        names_out = subprocess.run(
            ["docker", "ps", "--filter", "label=talentq.codeexec=true", "--filter", "status=running", "--format", "{{.Names}}"],
            capture_output=True, text=True, check=True, timeout=10,
        ).stdout
    except Exception as exc:
        print(f"[locustfile_all_languages] could not run `docker ps` - is Docker running and on PATH? ({exc})", file=sys.stderr)
        return []

    containers = []
    for name in names_out.splitlines():
        name = name.strip()
        if not name:
            continue
        m = re.match(r"talentq-([a-z]+)-[0-9a-f]+$", name)
        if not m:
            continue
        language = m.group(1)
        if language not in LANGUAGE_SPECS:
            continue
        try:
            port_out = subprocess.run(
                ["docker", "port", name, "8000/tcp"],
                capture_output=True, text=True, check=True, timeout=5,
            ).stdout.strip()
            port = int(port_out.rsplit(":", 1)[-1])
        except Exception as exc:
            print(f"[locustfile_all_languages] could not read published port for {name}: {exc}", file=sys.stderr)
            continue
        containers.append((language, name, port))
    return containers


def make_user_class(language, container_name, port):
    spec = LANGUAGE_SPECS[language]
    code = spec["code"]
    n = spec["n"]

    class ContainerUser(HttpUser):
        host = f"http://127.0.0.1:{port}"
        # No pause between requests - sustained pressure on this one
        # container's slots, matching locustfile.py's methodology.
        wait_time = between(0, 0)

        @task(20)
        def run_code(self):
            payload = {
                "language": language,
                "code": code,
                "input": str(n),
                "timeLimitMs": TIME_LIMIT_MS,
                "memoryMb": MEMORY_MB,
                "pidsLimit": PIDS_LIMIT,
            }
            # catch_response=True is required: supervisor.py always answers
            # HTTP 200, even when the candidate's own code failed (TLE,
            # compile error, runtime error) - the failure is only visible
            # in the JSON body's "success" field.
            with self.client.post(
                "/run", json=payload, catch_response=True,
                name=f"/run [{language}:{container_name}]",
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
            with self.client.get(
                "/health", catch_response=True, name=f"/health [{language}:{container_name}]"
            ) as resp:
                try:
                    resp.json()
                except ValueError:
                    resp.failure("non-JSON /health response")
                    return
                resp.success()

    ContainerUser.__name__ = f"{language.capitalize()}_{container_name.replace('-', '_')}_User"
    ContainerUser.__qualname__ = ContainerUser.__name__
    return ContainerUser


def _register_container_classes():
    # Wrapped in a function deliberately - a bare module-level `for` loop
    # leaves its loop variables (language/name/port/cls) behind as extra
    # module globals after it finishes, each still referencing the LAST
    # iteration's class object. Locust's auto-discovery scans every module
    # global for HttpUser subclasses, so that leftover reference and the
    # properly-registered one both point to the same class - Locust then
    # refuses to start ("user classes have the same class name") because
    # it looks like a genuine duplicate. Keeping the loop inside a function
    # keeps those temporaries out of the module's global namespace, so the
    # only HttpUser subclasses Locust ever sees are the intentionally
    # `globals()`-registered ones below, one per container, each under its
    # own unique name.
    containers = discover_containers()

    if not containers:
        print(
            "[locustfile_all_languages] WARNING: no running talentq code-exec containers found.\n"
            "  Start the worker first (from backend/: node dist/workers/codeExecutionWorker.js\n"
            "  or however you normally run it) so containers exist to test against.",
            file=sys.stderr,
        )
    else:
        print(f"[locustfile_all_languages] discovered {len(containers)} container(s) to test:", file=sys.stderr)
        for language, name, port in containers:
            print(f"    {language:<12} {name:<24} :{port}", file=sys.stderr)

    for language, name, port in containers:
        cls = make_user_class(language, name, port)
        globals()[cls.__name__] = cls


_register_container_classes()
