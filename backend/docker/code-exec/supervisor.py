#!/usr/bin/env python3
"""
Long-lived process that IS the container's PID 1 (see Dockerfile CMD).
Replaces the old "sleep infinity" + `docker exec` per job model: this
listens on a TCP port and accepts many concurrent job requests, running
each one as its own isolated OS process, so one container can serve many
candidates in parallel instead of one job blocking the whole container.

Runs as root (the container's default user - see Dockerfile) but with only
four capabilities retained (CapAdd: SETUID, SETGID, CHOWN, KILL in
pool.ts's container config; everything else is CapDrop: ALL). Root here is
*this trusted, reviewed supervisor* - every candidate submission runs as a
throwaway low-privilege sandbox UID with zero capabilities, dropped via
setuid()/setgid() before candidate code ever executes. no-new-privileges
(still set at the container level) does not block this: it only prevents
*gaining* privilege via exec of setuid binaries, not a process using
capabilities it already holds via direct syscalls. Notably absent:
CAP_DAC_OVERRIDE and CAP_FOWNER - their absence is why file writes have to
happen before chown, and chmod before chown, throughout run_job() below;
see the comments at each step for exactly why.
"""
import http.server
import json
import os
import re
import resource
import shutil
import signal
import subprocess
import threading
import time
import uuid

PORT = int(os.environ.get('SUPERVISOR_PORT', '8000'))
JOBS_ROOT = '/workspace/jobs'
MAX_OUTPUT_BYTES = 1024 * 1024  # 1MB, matches the old dockerExec.ts limit
COMPILE_TIMEOUT_SEC = 15

# Matches the Dockerfile's `useradd -u $((SANDBOX_UID_BASE+i))` loop -
# keep these two in sync if either changes. This is now a structural
# ceiling only (how many sandbox identities physically exist), not the
# real admission control - see has_resource_headroom() below for that.
SANDBOX_UID_BASE = 2000
SANDBOX_UID_COUNT = int(os.environ.get('SANDBOX_UID_COUNT', '20'))

_uid_lock = threading.Lock()
_free_uids = list(range(SANDBOX_UID_BASE + 1, SANDBOX_UID_BASE + 1 + SANDBOX_UID_COUNT))
_active_jobs_lock = threading.Lock()
_active_jobs = 0

# ==================== RESOURCE-AWARE ADMISSION CONTROL ====================
# Replaces "admit a job whenever a sandbox UID is free" (a pure headcount
# that has nothing to do with whether the container can actually *deliver*
# for one more job) with "admit a job whenever there's a free UID AND this
# container currently has real CPU/memory headroom". A fixed slot count
# can't know in advance how expensive a given piece of candidate code is;
# reading the container's own live cgroup state can, at admission time,
# which is the only point the code is being handed to us.
CGROUP_MEMORY_CURRENT = '/sys/fs/cgroup/memory.current'
CGROUP_MEMORY_MAX = '/sys/fs/cgroup/memory.max'
CGROUP_CPU_STAT = '/sys/fs/cgroup/cpu.stat'

# Refuse new admissions once already-used memory crosses this fraction of
# the container's limit - leaves headroom for the incoming job to actually
# grow into, rather than admitting right up to the edge and relying on the
# OOM killer (which doesn't know or care whose job it kills) as the only
# backstop. Confirmed by hand: OOM kills under concurrent memory-heavy
# jobs show up as an empty-error "Runtime error (non-zero exit code))" -
# this is what prevents that case instead of just reacting to it.
#
# 0.65 measured too loose by direct instrumentation: a live admit-decision
# log during an 8-way simultaneous burst (REALISTIC/sieve workload, 256MB/
# 2.0 CPU container) showed 6 jobs admitted within ~0.9s, well past this
# workload's previously-confirmed safe ceiling, because memory.current
# hadn't climbed enough yet at the moment each admission check ran.
#
# Separately measured the TRUE simultaneous (not staggered-arrival) safe
# ceiling directly, isolated from the admission gate entirely: fired raw
# N-way simultaneous /run bursts against fresh containers at this same
# 256MB/2.0-CPU config. N=2 finished in ~3.0s, N=3 in ~4.0-4.4s (both under
# the 5s timeLimit budget), N=4 mostly failed with genuine 5000ms TLE
# (3 of 4). So the real ceiling here is 3 TRUE-simultaneous, not the 4
# found by the earlier session's Locust testing - that measurement had
# enough real-world dispatch jitter between "concurrent" requests to be
# meaningfully less punishing than a genuine single-instant burst, which is
# exactly the case this admission gate has to hold up under. Set to 0.30 -
# in the debug log, ratio after the 3rd admission was ~0.250 and after the
# 4th was ~0.337, so 0.30 sits between them and blocks the 4th, not the 5th.
MEMORY_ADMISSION_THRESHOLD = float(os.environ.get('MEMORY_ADMISSION_THRESHOLD', '0.30'))

# If the container has spent at least this fraction of the last sample
# window being throttled by the kernel (cpu.stat's throttled_usec, sampled
# as a rate rather than the cumulative lifetime total), treat it as
# CPU-saturated and refuse new admissions - directly targets the
# Time-Limit-Exceeded failure mode confirmed earlier this session
# (nr_throttled climbing continuously under overcommitted concurrency).
#
# 0.5 lowered to 0.3: at 0.5, the same burst instrumentation showed
# cpu_sat flickering true/false between consecutive ~0.1s-apart samples
# (e.g. cpu_sat=True immediately followed 1ms later by cpu_sat=False) -
# a genuinely overcommitted container's throttle rate is noisy enough
# call-to-call that a 50%-of-window bar let plenty of saturated moments
# read as "fine" by pure chance of which window the sample landed in.
# 0.3 catches real contention earlier and more consistently; paired with
# widening _MIN_CPU_SAMPLE_WINDOW_SEC below, which does more of the actual
# smoothing work.
CPU_THROTTLE_ADMISSION_THRESHOLD = float(os.environ.get('CPU_THROTTLE_ADMISSION_THRESHOLD', '0.3'))
# 0.1 -> 0.25: the same instrumentation showed the flicker above coming
# from windows barely over the old 0.1s minimum - too short relative to
# the kernel's default 100ms CFS accounting period to average out more
# than ~1 period of noise. 0.25s spans multiple periods, giving nr_periods/
# throttled_usec time to reflect sustained pressure rather than a single
# noisy tick. Deliberately kept equal to _ADMISSION_STAGGER_SEC below so
# every stagger step lines up with a fresh, meaningfully-sized CPU sample
# instead of racing ahead of it.
_MIN_CPU_SAMPLE_WINDOW_SEC = 0.25  # below this, the rate is too noisy to trust - fail open, don't flap

_cpu_check_lock = threading.Lock()
_last_cpu_check = {'time': None, 'throttled_usec': 0}  # time=None is the "never sampled" sentinel - see _is_cpu_saturated()
# Cached result of the last REAL saturation computation (i.e. the last time
# _is_cpu_saturated() actually advanced the rolling window below, not one of
# its fail-open/too-soon early returns). /health reads THIS instead of
# calling _is_cpu_saturated() directly - otherwise frequent health polling
# (pool.ts's periodic sweep, readiness checks, manual curls) would advance
# _last_cpu_check's timestamp/baseline itself and steal samples from the
# real admission-time throttle-rate calculation in acquire_uid(), distorting
# the exact signal this whole mechanism depends on.
_last_saturation_result = False


def _read_memory_ratio():
    try:
        with open(CGROUP_MEMORY_CURRENT) as f:
            current = int(f.read())
        with open(CGROUP_MEMORY_MAX) as f:
            raw = f.read().strip()
        if raw == 'max':
            return 0.0  # no cgroup limit configured - never block admission on this
        return current / int(raw)
    except Exception:
        return 0.0  # fail OPEN: if the cgroup file can't be read, don't block on a signal we don't have


def _is_cpu_saturated():
    global _last_saturation_result
    try:
        with open(CGROUP_CPU_STAT) as f:
            stats = dict(line.split() for line in f.read().splitlines())
        throttled_usec = int(stats['throttled_usec'])
    except Exception:
        return False  # fail open, same reasoning as _read_memory_ratio

    now = time.time()
    with _cpu_check_lock:
        prev_time = _last_cpu_check['time']
        prev_throttled = _last_cpu_check['throttled_usec']
        if prev_time is None:
            # First sample ever - nothing to compute a rate against yet.
            # Record the baseline now so a call >= _MIN_CPU_SAMPLE_WINDOW_SEC
            # from now can compute a real rate. Deliberately NOT using
            # `if prev_time else 0.0`/0.0-as-sentinel here: that collapses
            # "never sampled" and "sampled too recently" into the same
            # branch, which never advances the baseline past its initial
            # value - _is_cpu_saturated() would return False forever, no
            # matter how much real throttling occurs (confirmed by hand:
            # an 8-way simultaneous burst produced zero admission
            # rejections and 100% real TLE/OOM failures under the old
            # logic).
            _last_cpu_check['time'] = now
            _last_cpu_check['throttled_usec'] = throttled_usec
            return False
        elapsed = now - prev_time
        if elapsed < _MIN_CPU_SAMPLE_WINDOW_SEC:
            # Too soon since the last sample for a meaningful rate - don't
            # update the baseline (let the window keep accumulating) and
            # don't block on a noisy near-instant re-check.
            return False
        _last_cpu_check['time'] = now
        _last_cpu_check['throttled_usec'] = throttled_usec

    throttled_delta_sec = (throttled_usec - prev_throttled) / 1_000_000
    result = (throttled_delta_sec / elapsed) >= CPU_THROTTLE_ADMISSION_THRESHOLD
    _last_saturation_result = result
    return result


def has_resource_headroom():
    if _read_memory_ratio() >= MEMORY_ADMISSION_THRESHOLD:
        return False
    if _is_cpu_saturated():
        return False
    return True


# Minimum spacing between two admission GRANTS. Exists because
# has_resource_headroom() alone is a point-in-time cgroup snapshot, and a
# burst of near-simultaneous requests (e.g. a test's whole cohort clicking
# Run at once) all call it within microseconds of each other, before any of
# them have actually started consuming CPU/memory yet — memory.current and
# cpu.stat's throttled_usec simply haven't caught up. Verified by hand: an
# 8-way simultaneous burst against a 4-slots-safe/8-slots-max container sailed
# straight through this gate with zero rejections (every job admitted, then
# genuinely contended and failed with real TLE/OOM) BEFORE this stagger
# existed. Forcing at least _ADMISSION_STAGGER_SEC between grants turns a
# burst into a fast ramp instead of a simultaneous flood, giving each
# already-admitted job enough wall-clock time to show up in the cgroup
# counters before the next admission decision runs — so if the container
# genuinely can't sustain more concurrency, the LATER arrivals in the same
# burst are the ones that see saturation and get "Server is busy" (retried
# on a different container by codeExecutionWorker.ts), rather than every
# job in the burst racing through and failing together.
# Kept equal to _MIN_CPU_SAMPLE_WINDOW_SEC (see its comment) so every
# stagger step lines up with a fresh CPU sample rather than racing ahead of
# it and re-checking a window that hasn't advanced yet.
_ADMISSION_STAGGER_SEC = float(os.environ.get('ADMISSION_STAGGER_SEC', '0.25'))
_admission_lock = threading.Lock()
_last_admission_time = 0.0


def _try_admit():
    """Atomically checks admission pacing AND resource headroom, and
    reserves the next admission slot if both pass. Must wrap the actual UID
    grant so the two checks and the pacing update happen as one step -
    otherwise concurrent callers could all pass the pacing check before any
    of them updates _last_admission_time, defeating the stagger."""
    global _last_admission_time
    with _admission_lock:
        now = time.time()
        if now - _last_admission_time < _ADMISSION_STAGGER_SEC:
            return False
        if not has_resource_headroom():
            return False
        _last_admission_time = now
        return True


# 10.0 -> 4.0: this internal wait and codeExecutionWorker.ts's cross-
# container retry loop share the SAME outer time budget (enqueue.ts's
# waitTimeoutMs = timeLimit + 10s headroom - 15s total for a 5s
# timeLimit). A single blocked attempt waiting the old full 10s before
# reporting "Server is busy" left almost no time for a retry on a
# different/newly-scaled container to also run (itself up to ~timeLimit
# seconds) within that shared budget - confirmed by hand: a 16-job burst
# through the real BullMQ+worker+retry path produced both genuine TLEs
# (too many admitted at once - see MEMORY_ADMISSION_THRESHOLD's history)
# AND exhausted-retry "Server is busy" failures for jobs whose every
# attempt individually looked reasonable but collectively blew the shared
# time budget. 4s is enough to catch one "an already-running job finishes,
# frees a slot" cycle (observed run times were ~3-4s for the sieve
# workload) without eating so much of the shared budget that a retry
# elsewhere has no time left to succeed.
def acquire_uid(timeout_sec=4.0):
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        # _try_admit() gates entry on BOTH real resource headroom and
        # admission pacing (see its docstring) - a free sandbox identity
        # doesn't mean the container can actually deliver for it right now,
        # and passing the resource check alone isn't enough under a burst
        # (see _ADMISSION_STAGGER_SEC's comment).
        if _try_admit():
            with _uid_lock:
                if _free_uids:
                    return _free_uids.pop()
        time.sleep(0.05)
    return None


def release_uid(uid):
    with _uid_lock:
        _free_uids.append(uid)


LANGUAGE_CONFIG = {
    'python': {'file': 'main.py', 'run': ['python3', '-u', 'main.py']},
    'javascript': {'file': 'main.js', 'run': ['node', '--max-old-space-size=256', 'main.js']},
    'java': {'file': None, 'run': None},  # resolved dynamically below (class name from source)
    'cpp': {'file': 'main.cpp', 'compile': ['g++', '-O2', '-o', 'main', 'main.cpp'], 'run': ['./main']},
    'c': {'file': 'main.c', 'compile': ['gcc', '-O2', '-o', 'main', 'main.c'], 'run': ['./main']},
}


def detect_java_class(code):
    m = re.search(r'public\s+class\s+(\w+)', code)
    return m.group(1) if m else 'Main'


# RLIMIT_AS caps *virtual address space*, not physical memory used - fine
# for python/c/cpp, where the two track closely, but V8 (node) and the JVM
# (java) both reserve large virtual ranges up front regardless of actual
# usage (V8's CodeRange, the JVM's code cache/heap/metaspace reservations)
# and hit that ceiling on startup before running a single line of candidate
# code - confirmed by hand: node fatally OOMs ("Failed to reserve virtual
# memory for CodeRange") and javac fails ("Could not reserve enough space
# for code cache") purely from RLIMIT_AS, with nothing to do with the
# candidate's actual code. These two rely on the container's own `--memory`
# cgroup limit (pool.ts) for real enforcement instead, which accounts
# physical usage (RSS), not virtual reservation.
LANGUAGES_WITHOUT_RLIMIT_AS = {'javascript', 'java'}


def make_preexec(uid, mem_bytes, cpu_sec, pids_limit, apply_mem_limit=True):
    """Runs in the forked child, after fork() but before exec() (Python's
    subprocess preexec_fn contract). Order matters: rlimits are set while
    still root (so they can't later be raised back), group is dropped
    before user (dropping uid first would remove permission to change
    gid), and this is a one-way trip - once setuid() succeeds the process
    can never regain root or any capability, by kernel guarantee."""
    def _preexec():
        os.setsid()  # own process group, so a timeout can SIGKILL the whole tree, not just the direct child
        if apply_mem_limit:
            resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_sec, cpu_sec))
        resource.setrlimit(resource.RLIMIT_NPROC, (pids_limit, pids_limit))
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES * 4, MAX_OUTPUT_BYTES * 4))
        os.setgid(uid)
        os.setuid(uid)
    return _preexec


def run_subprocess(cmd, cwd, uid, mem_bytes, cpu_sec, pids_limit, timeout_sec, input_bytes, apply_mem_limit=True):
    # Popen directly, not subprocess.run(timeout=...): run()'s own timeout
    # handling only has access to the exception object, not the Popen
    # instance, so there's no correct pid to killpg() on timeout from
    # inside the except block. Keeping the Popen reference here means the
    # kill always targets *this specific job's* process group (setsid() in
    # the preexec made pid == pgid), never anything else's.
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        preexec_fn=make_preexec(uid, mem_bytes, cpu_sec, pids_limit, apply_mem_limit),
    )
    try:
        out, err = proc.communicate(input=input_bytes, timeout=timeout_sec)
        return proc.returncode, out[:MAX_OUTPUT_BYTES], err[:MAX_OUTPUT_BYTES], False
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        # Bounded, not unconditional: a grandchild that called its own
        # setsid() before the kill escapes the process group entirely (the
        # original process's own setsid() in preexec only scopes killpg to
        # processes that stayed in that group) and can keep holding the
        # stdout/stderr pipes open, which would otherwise hang this
        # communicate() forever - not just this one job, but permanently
        # leaking a sandbox UID out of the pool (release_uid() in run_job's
        # finally block never runs while this is stuck), silently shrinking
        # that container's real concurrency ceiling job by job. A short
        # second timeout means the worst case is losing that job's output
        # instead of losing a slot forever.
        try:
            out, err = proc.communicate(timeout=2)
        except subprocess.TimeoutExpired:
            out, err = b'', b''
        return None, out[:MAX_OUTPUT_BYTES] if out else b'', err[:MAX_OUTPUT_BYTES] if err else b'', True


def run_job(data):
    global _active_jobs
    language = data.get('language')
    code = data.get('code', '')
    input_data = data.get('input', '') or ''
    time_limit_ms = int(data.get('timeLimitMs', 5000))
    memory_mb = int(data.get('memoryMb', 256))
    pids_limit = int(data.get('pidsLimit', 64))

    if language not in LANGUAGE_CONFIG:
        return {'success': False, 'error': f'Unsupported language: {language}'}
    if not code.strip():
        return {'success': False, 'error': 'No code provided'}

    uid = acquire_uid()
    if uid is None:
        # Every sandbox UID is mid-execution - this container is genuinely
        # full, distinct from "server busy" at the pool level (pool.ts
        # shouldn't route here if it thinks a slot is free, but this is the
        # backstop if it ever races).
        return {'success': False, 'error': 'Server is busy. Please try again in a few seconds.'}

    with _active_jobs_lock:
        _active_jobs += 1

    job_id = str(uuid.uuid4())
    job_dir = os.path.join(JOBS_ROOT, job_id)
    mem_bytes = memory_mb * 1024 * 1024
    cpu_sec = max(1, (time_limit_ms // 1000) + 2)

    try:
        # Written while the dir is still root-owned, deliberately: root
        # here has CAP_CHOWN/SETUID/SETGID/KILL but *not* CAP_DAC_OVERRIDE
        # (CapDrop: ALL in pool.ts's container config, only those four
        # added back) — so once a path is chowned to the sandbox uid,
        # root can no longer write into it, only that uid can. Everything
        # that needs writing has to happen before the chown below, not
        # after.
        os.makedirs(job_dir, mode=0o700)

        if language == 'java':
            class_name = detect_java_class(code)
            file_name = f'{class_name}.java'
        else:
            file_name = LANGUAGE_CONFIG[language]['file']

        file_path = os.path.join(job_dir, file_name)
        with open(file_path, 'w') as f:
            f.write(code)

        input_bytes = input_data.encode('utf-8', 'replace')

        # Files chowned to the sandbox uid *first*, while job_dir is still
        # root:root 0700 (root can still traverse in) — then job_dir itself
        # last. Doing the directory first would strip root's own search
        # permission into it (0700, no longer root-owned) before the file
        # chowns ever ran, which is exactly what broke this the first time.
        for name in os.listdir(job_dir):
            os.chown(os.path.join(job_dir, name), uid, uid)

        # chmod before chown, not after: changing a path's mode requires
        # owning it (or CAP_FOWNER, which root doesn't have here — only
        # CHOWN/SETUID/SETGID/KILL are granted) — root still owns job_dir
        # at this point, so this works; doing it after the chown below
        # would EPERM the same way the reordering above was needed for.
        #
        # Directory ends up owned by the sandbox uid (full rwx as owner)
        # but *group*-owned by root with group rwx too (0770, nothing for
        # "other") — not (uid, uid) — specifically so the finally block's
        # shutil.rmtree, running as root, can still traverse/delete it for
        # cleanup. Other sandbox uids get zero access either way (they're
        # neither the owner nor in group 0), so this doesn't weaken
        # isolation between concurrent jobs, only root's own housekeeping.
        os.chmod(job_dir, 0o770)
        os.chown(job_dir, uid, 0)

        start = time.time()

        compile_cfg = LANGUAGE_CONFIG[language].get('compile')
        if language == 'java':
            compile_cmd = ['javac', file_name]
        elif compile_cfg:
            compile_cmd = compile_cfg
        else:
            compile_cmd = None

        apply_mem_limit = language not in LANGUAGES_WITHOUT_RLIMIT_AS

        if compile_cmd:
            rc, out, err, timed_out = run_subprocess(
                compile_cmd, job_dir, uid, mem_bytes, COMPILE_TIMEOUT_SEC, pids_limit,
                COMPILE_TIMEOUT_SEC, b'', apply_mem_limit
            )
            if timed_out or rc != 0:
                msg = (err or out or b'Unknown compilation error').decode('utf-8', 'replace')
                return {'success': False, 'error': f'Compilation Error:\n{msg[:2000]}', 'executionTime': int((time.time() - start) * 1000)}

        if language == 'java':
            run_cmd = ['java', '-Xmx%dm' % min(256, memory_mb), '-cp', job_dir, class_name]
        else:
            run_cmd = LANGUAGE_CONFIG[language]['run']

        rc, out, err, timed_out = run_subprocess(
            run_cmd, job_dir, uid, mem_bytes, cpu_sec, pids_limit,
            time_limit_ms / 1000.0, input_bytes, apply_mem_limit
        )
        exec_time_ms = int((time.time() - start) * 1000)

        if timed_out:
            return {'success': False, 'error': 'Time Limit Exceeded - Your code took too long to execute', 'executionTime': time_limit_ms}
        if rc != 0:
            msg = (err or b'Runtime error (non-zero exit code)').decode('utf-8', 'replace')
            return {'success': False, 'error': f'Runtime Error:\n{msg[:2000]}', 'executionTime': exec_time_ms}

        return {'success': True, 'output': out.decode('utf-8', 'replace').strip(), 'executionTime': exec_time_ms}
    except Exception as e:
        import traceback
        traceback.print_exc()  # visible via `docker logs` for debugging
        return {'success': False, 'error': f'Supervisor error: {e}'}
    finally:
        release_uid(uid)
        with _active_jobs_lock:
            _active_jobs -= 1
        shutil.rmtree(job_dir, ignore_errors=True)


class Handler(http.server.BaseHTTPRequestHandler):
    # Default is HTTP/1.0 (no keep-alive) - every single request, including
    # /health polls, would open and tear down its own fresh TCP connection.
    # Under real concurrent load (many candidates, plus pool.ts's periodic
    # health sweep) that multiplies connection churn far beyond what's
    # actually needed, making it more likely for a request to queue behind
    # accept() / thread spawn overhead instead of a receiving a prompt
    # response - directly contributed to health checks timing out under
    # Locust load and pool.ts's healthSweep() concluding busy-but-healthy
    # containers were dead. HTTP/1.1 keeps connections open and reused.
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        pass  # keep stdout clean; docker logs still capture crashes/tracebacks

    def _send_json(self, status, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/health':
            with _uid_lock:
                free = len(_free_uids)
            self._send_json(200, {
                'status': 'ok',
                'freeSlots': free,
                'maxSlots': SANDBOX_UID_COUNT,
                # Resource-admission state, separate from freeSlots: a
                # container can show free UIDs here while still being
                # resource-saturated (has_resource_headroom() gates
                # acquire_uid() on both, not just UID count) - this
                # exposes *why* jobs might currently be waiting even
                # though freeSlots > 0.
                # cpuSaturated reads the CACHED result of the last real
                # admission-time computation rather than calling
                # _is_cpu_saturated() directly - calling it here would
                # advance its rolling-window baseline on every health poll
                # and distort the real throttle-rate sampling used to gate
                # acquire_uid().
                'memoryRatio': round(_read_memory_ratio(), 3),
                'cpuSaturated': _last_saturation_result,
            })
        else:
            self._send_json(404, {'error': 'not found'})

    def do_POST(self):
        if self.path != '/run':
            self._send_json(404, {'error': 'not found'})
            return
        length = int(self.headers.get('Content-Length', 0))
        try:
            data = json.loads(self.rfile.read(length) or b'{}')
        except json.JSONDecodeError:
            self._send_json(400, {'error': 'invalid json'})
            return
        result = run_job(data)
        self._send_json(200, result)


def main():
    os.makedirs(JOBS_ROOT, mode=0o1777, exist_ok=True)
    # ThreadingHTTPServer: each request handled on its own thread, so N
    # concurrent /run calls genuinely run in parallel (the heavy lifting is
    # subprocess.run(), which releases the GIL while the child process
    # executes) rather than queuing behind one another.
    server = http.server.ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    # socketserver's default request_queue_size (5) is the TCP listen()
    # backlog - under real concurrent load (many candidates + pool.ts's
    # periodic /health polling), more than 5 near-simultaneous connection
    # attempts landing while the accept loop is itself momentarily delayed
    # (e.g. by cgroup CPU contention from real candidate jobs) get refused/
    # reset at the OS level instead of queuing - this is what produced the
    # empty ("non-JSON") responses seen under Locust load. A larger backlog
    # gives the OS room to hold pending connections until this process's
    # accept loop gets scheduled, rather than dropping them.
    server.request_queue_size = 128
    server.daemon_threads = True
    server.serve_forever()


if __name__ == '__main__':
    main()
