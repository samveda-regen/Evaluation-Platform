import Docker from 'dockerode';
import http from 'http';
import { randomBytes } from 'crypto';
import { PoolStats } from './types.js';

export const CODE_EXEC_LABEL = 'talentq.codeexec';
export const SUPERVISOR_PORT = 8000;

// Only used for the egress-firewall helper container below - actual pool
// containers are created with their own language-specific image, passed in
// per-language via PoolConfig.image (see codeExecutionWorker.ts's
// POOL_DEFAULTS). The helper only needs iptables (present in every image
// since it's installed in the shared base layer), not any language
// runtime, so it always uses the base image specifically rather than
// whichever language happened to be configured first.
const CODE_EXEC_BASE_IMAGE = process.env.CODE_EXEC_BASE_IMAGE || 'talentq/code-exec-base:dev';
const CODE_EXEC_NETWORK = process.env.CODE_EXEC_DOCKER_NETWORK || 'talentq-code-exec-net';
const CONTAINER_MEMORY_MB = Number(process.env.CODE_EXEC_CONTAINER_MEMORY_MB || 256);
const CONTAINER_CPU_CORES = Number(process.env.CODE_EXEC_CONTAINER_CPUS || 0.5);
const CONTAINER_PIDS_LIMIT = Number(process.env.CODE_EXEC_CONTAINER_PIDS_LIMIT || 64);
// Fallback only — every language configured in codeExecutionWorker.ts's
// POOL_DEFAULTS passes its own slots value explicitly via PoolConfig.
// Matters because one shared slot count is wrong across languages with
// very different per-execution CPU needs: 8 lightweight Python/JS jobs
// share a container's 0.5 CPU fine, but 8 concurrent JVM compile+starts
// sharing that same 0.5 CPU starve each other badly enough to blow past
// both the per-job timeLimit and the outer wait timeout — confirmed by
// hand (8-way concurrent Java load: every job failed; 3-way: all fine).
const DEFAULT_SLOTS_PER_CONTAINER = Number(process.env.CODE_EXEC_SLOTS_PER_CONTAINER || 8);
// Lifetime retirement threshold — much higher than the old per-container
// value (50) since one container now serves many concurrent jobs, not one
// at a time, so it reaches any given job-count far faster.
const MAX_JOBS_PER_CONTAINER_LIFETIME = Number(process.env.CODE_EXEC_MAX_EXECS_PER_CONTAINER || 2000);

const HEALTH_CHECK_INTERVAL_MS = 30_000;
// 2000 -> 5000: a container legitimately busy running real candidate code
// is CPU-throttled by its own cgroup quota (CONTAINER_CPU_CORES), and that
// throttling delays EVERY thread in the container, including the one
// answering this health check - a tight timeout makes real load look
// identical to a dead process.
const HEALTH_CHECK_TIMEOUT_MS = 5000;
// A single failed/slow health check is expected background noise under
// real load, not evidence the container is dead - confirmed by hand:
// under sustained Locust load, containers were dying in matching pairs
// roughly every HEALTH_CHECK_INTERVAL_MS, exitCode 137, i.e. THIS
// process's own markDead() force-killing perfectly healthy containers
// mid-job because one health check happened to lose the race for CPU
// time against the real candidate work it was doing. A busy container
// (activeJobs > 0) gets a much more lenient threshold than an idle one,
// since idle containers have no legitimate reason to be CPU-starved.
const IDLE_HEALTH_FAILURE_THRESHOLD = 2;
const BUSY_HEALTH_FAILURE_THRESHOLD = 5;
const IDLE_SCALE_DOWN_MS = 5 * 60_000;
const IDLE_SCALE_DOWN_CHECK_MS = 60_000;
const SUPERVISOR_READY_TIMEOUT_MS = 5000;
// How long a container that just reported "Server is busy" (supervisor.py's
// resource-headroom gate refused admission, or every sandbox UID was
// taken) is excluded from new job assignment. Short on purpose: this is a
// momentary saturation signal, not a health problem, and the underlying
// cgroup pressure that caused it is typically gone within a second or two
// once the jobs currently running on it finish. Too long would waste real
// capacity; too short would just re-hit the same saturated container.
const RESOURCE_BUSY_COOLDOWN_MS = Number(process.env.CODE_EXEC_RESOURCE_BUSY_COOLDOWN_MS || 2000);

interface PoolConfig {
  min: number;
  max: number;
  slotsPerContainer?: number;
  // Which image this language's containers are created from - each
  // language now gets its own image (talentq/code-exec-<lang>:dev),
  // FROM talentq/code-exec-base:dev with just that language's runtime/
  // compiler layered on top. Required, not defaulted here, because there
  // is no longer a single shared image that would make sense as a
  // fallback - see codeExecutionWorker.ts's POOL_DEFAULTS for the actual
  // per-language default values.
  image: string;
}

export interface ManagedContainer {
  id: string;
  hostPort: number;
  activeJobs: number;
  totalJobs: number;
  lastUsedAt: number;
  healthy: boolean;
  // Past its lifetime job limit but still serving other concurrent
  // candidates — excluded from new job assignment (see acquire()'s
  // `withRoom` filter) but not destroyed until it drains to activeJobs===0
  // on its own. Destroying it immediately, the way an unhealthy container
  // is, would kill every other candidate still actively using it.
  retiring: boolean;
  // Timestamp (Date.now()-comparable) until which this container is
  // excluded from new job assignment because it just reported itself
  // resource-saturated (see markBusy()) — 0 means not in cooldown. Distinct
  // from `retiring`/`healthy`: the container process itself is fine, it's
  // just momentarily out of real CPU/memory headroom under
  // supervisor.py's own admission gate, even though activeJobs < slots
  // (the slot count tracks issued jobs, not live cgroup pressure).
  resourceBusyUntil: number;
  // Consecutive failed/timed-out /health checks from healthSweep() - reset
  // to 0 on any success. See IDLE_HEALTH_FAILURE_THRESHOLD /
  // BUSY_HEALTH_FAILURE_THRESHOLD for why this isn't "dead on first miss."
  consecutiveHealthFailures: number;
}

function httpGetJson(hostPort: number, path: string, timeoutMs: number): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: hostPort, path, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 0, body: JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}') });
        } catch {
          resolve({ status: res.statusCode || 0, body: null });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('health check timed out')));
    req.on('error', reject);
  });
}

class LanguagePool {
  private containers: ManagedContainer[] = [];
  private starting = 0;
  private readonly waiters: Array<(container: ManagedContainer) => void> = [];
  private readonly slots: number;

  constructor(
    private readonly docker: Docker,
    private readonly language: string,
    private readonly config: PoolConfig,
    // Callback into ContainerPoolManager, the one component with
    // visibility across every language's pool — see its
    // hasGlobalCpuHeadroom() for why this pool alone can't make this call.
    private readonly hasGlobalCpuHeadroom: () => boolean
  ) {
    this.slots = config.slotsPerContainer ?? DEFAULT_SLOTS_PER_CONTAINER;
  }

  // Containers currently doing real work, as opposed to warm-and-idle
  // (which draw near-zero real host CPU regardless of their NanoCpus
  // ceiling). ContainerPoolManager sums this across every language's pool
  // to estimate actual host-wide CPU demand.
  busyContainerCount(): number {
    return this.containers.filter((c) => c.activeJobs > 0).length;
  }

  stats(): PoolStats {
    const activeJobs = this.containers.reduce((sum, c) => sum + c.activeJobs, 0);
    // Retiring containers' unfilled slots aren't real spare capacity —
    // acquire() already refuses to route new jobs to them — so they're
    // excluded here too, otherwise stats() overstates how much room the
    // pool actually has for a new candidate.
    const totalSlots = this.containers.filter((c) => !c.retiring).length * this.slots;
    return {
      language: this.language,
      idle: Math.max(0, totalSlots - activeJobs),
      busy: activeJobs,
      total: this.containers.length,
      min: this.config.min,
      max: this.config.max,
    };
  }

  async prewarm(): Promise<void> {
    const toCreate = this.config.min - (this.containers.length + this.starting);
    await Promise.all(Array.from({ length: Math.max(0, toCreate) }, () => this.spawnOne()));
  }

  private async waitForSupervisorReady(hostPort: number): Promise<boolean> {
    const deadline = Date.now() + SUPERVISOR_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const { status } = await httpGetJson(hostPort, '/health', 500);
        if (status === 200) return true;
      } catch {
        // supervisor not accepting connections yet — keep polling
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  private async spawnOne(): Promise<ManagedContainer | null> {
    this.starting += 1;
    try {
      const container = await this.docker.createContainer({
        // Docker container names must be unique daemon-wide, so a plain
        // "talentq-python" would collide the moment a second Python
        // container exists — a short random suffix guarantees uniqueness
        // without needing a counter to track (which would itself risk
        // colliding with a name left over from a previous worker run after
        // a restart). The language is the whole point of this, though:
        // `docker ps` now shows "talentq-python-a3f9c2" instead of Docker's
        // default random name like "confident_shirley", so which pool a
        // given container belongs to is visible without inspecting labels.
        name: `talentq-${this.language}-${randomBytes(3).toString('hex')}`,
        Image: this.config.image,
        WorkingDir: '/workspace',
        ExposedPorts: { [`${SUPERVISOR_PORT}/tcp`]: {} },
        // Overrides the image's default SANDBOX_UID_COUNT (8) down to
        // however many concurrent slots *this* language's pool is actually
        // configured for — the image always pre-creates 8 sandbox UIDs at
        // build time (enough for the largest realistic per-language slot
        // count), and each container is just told at creation time how
        // many of those 8 to actually use as its concurrency ceiling.
        Env: [`SANDBOX_UID_COUNT=${this.slots}`],
        HostConfig: {
          // supervisor.py is this container's actual PID 1 (no other init
          // process wraps it — see Dockerfile CMD) and PID 1 is
          // responsible for reaping zombie processes reparented to it,
          // which a Python http.server does nothing to handle. Normally
          // harmless, but a job whose process tree escapes killpg (a
          // grandchild that calls its own setsid() before being killed —
          // see run_subprocess's timeout-kill comment in supervisor.py)
          // would otherwise leave an unreaped zombie sitting under real
          // PID 1 forever. Init:true wraps the entrypoint with Docker's
          // bundled tini as the real PID 1 instead (verified by hand:
          // /proc/1/comm reports "docker-init"), which reaps for free —
          // no code change to supervisor.py needed for this specific class
          // of leak.
          Init: true,
          ReadonlyRootfs: true,
          // Sized for up to `this.slots` concurrent jobs' files at once
          // (each in its own /workspace/jobs/<uuid> subdir), not one.
          Tmpfs: { '/workspace': 'rw,exec,size=256m,mode=1777', '/tmp': 'rw,exec,size=16m,mode=1777' },
          NetworkMode: CODE_EXEC_NETWORK,
          // Loopback-only — reachable from the worker process on this host,
          // never from outside the machine. Candidate code's own outbound
          // internet access is blocked separately, host-wide, by
          // ContainerPoolManager.applyEgressFirewall() — a non-Internal
          // bridge network is required here only because Docker doesn't
          // publish ports on an Internal:true one (verified by hand; see
          // ensureNetwork()'s comment for the full story).
          PortBindings: { [`${SUPERVISOR_PORT}/tcp`]: [{ HostIp: '127.0.0.1', HostPort: '0' }] },
          Memory: CONTAINER_MEMORY_MB * 1024 * 1024,
          MemorySwap: CONTAINER_MEMORY_MB * 1024 * 1024,
          NanoCpus: Math.round(CONTAINER_CPU_CORES * 1_000_000_000),
          // Container-wide ceiling across the supervisor + every concurrent
          // job's own per-job RLIMIT_NPROC — a generous multiple, not a
          // per-job number (that's supervisor.py's job).
          PidsLimit: CONTAINER_PIDS_LIMIT * this.slots,
          // Four capabilities added back on top of CapDrop: ALL — verified
          // by hand to be exactly what supervisor.py needs and no more:
          // SETUID/SETGID to drop each job to its own sandbox UID, CHOWN
          // to hand job files/dirs over to that UID, KILL to signal a
          // *different* UID's process group on timeout (a plain SIGKILL
          // from one uid to another's process requires this capability,
          // discovered when the timeout-kill path failed without it).
          // Deliberately does NOT include DAC_OVERRIDE or FOWNER — their
          // absence is why supervisor.py's file/chmod/chown operations
          // have to happen in a specific order (see its comments); adding
          // either would remove that constraint but also broaden what a
          // compromised supervisor could do, so the order-dependent code
          // was kept in favor of the narrower capability set.
          CapDrop: ['ALL'],
          CapAdd: ['SETUID', 'SETGID', 'CHOWN', 'KILL'],
          SecurityOpt: ['no-new-privileges'],
        },
        Labels: {
          [CODE_EXEC_LABEL]: 'true',
          'talentq.pool': this.language,
        },
      });

      await container.start();
      const info = await container.inspect();
      const hostPortStr = info.NetworkSettings?.Ports?.[`${SUPERVISOR_PORT}/tcp`]?.[0]?.HostPort;
      const hostPort = hostPortStr ? Number(hostPortStr) : null;

      if (!hostPort || !(await this.waitForSupervisorReady(hostPort))) {
        await this.destroyById(container.id);
        return null;
      }

      const managed: ManagedContainer = {
        id: container.id,
        hostPort,
        activeJobs: 0,
        totalJobs: 0,
        lastUsedAt: Date.now(),
        healthy: true,
        retiring: false,
        resourceBusyUntil: 0,
        consecutiveHealthFailures: 0,
      };
      this.containers.push(managed);
      this.wakeWaiters();
      return managed;
    } catch (err) {
      console.error(`[codeExecPool:${this.language}] spawn failed:`, (err as Error).message);
      return null;
    } finally {
      this.starting -= 1;
    }
  }

  private hasSpareCapacity(c: ManagedContainer): boolean {
    return c.healthy && !c.retiring && c.activeJobs < this.slots && c.resourceBusyUntil <= Date.now();
  }

  private wakeWaiters(): void {
    while (this.waiters.length > 0) {
      const target = this.containers.find((c) => this.hasSpareCapacity(c));
      if (!target) break;
      const waiter = this.waiters.shift();
      if (waiter) waiter(target);
    }
  }

  // Unconditional growth trigger — skips the "does anything already have
  // room" check that maybeScaleUp() does, because the caller (markBusy())
  // already knows the answer is effectively no: a container just refused a
  // job for resource reasons even though its slot count said it had room.
  private forceScaleUp(): void {
    const total = this.containers.length + this.starting;
    if (total >= this.config.max) return;
    // A brand-new container starts idle and gets activated by whatever job
    // triggered this scale-up - so spawning one here is exactly the action
    // hasGlobalCpuHeadroom() exists to gate (see its comment on
    // ContainerPoolManager). Refusing to spawn when the host has no real
    // CPU left doesn't drop the job - it falls through to acquire()'s
    // waiter queue instead, which is the "queue them" half of "admits jobs
    // only when sufficient CPU/memory are available, otherwise queues them
    // or scales by creating additional containers."
    if (!this.hasGlobalCpuHeadroom()) return;
    this.spawnOne().catch(() => {});
  }

  private maybeScaleUp(): void {
    const hasRoom = this.containers.some((c) => this.hasSpareCapacity(c));
    // Only the "every slot in every existing container is full" condition
    // triggers growth — matches the requirement that candidates share
    // whatever room already exists before a new container gets spun up.
    if (hasRoom) return;
    this.forceScaleUp();
  }

  // Called when a container reports itself resource-saturated (see
  // ManagedContainer.resourceBusyUntil) rather than crashed/dead. The
  // container stays in rotation — nothing is actually broken with it — but
  // is excluded from new job assignment for a short cooldown, and the pool
  // scales up immediately rather than waiting for the next acquire() call
  // to notice: a resource-busy signal means real capacity is currently
  // below what the slot count advertises, right now, not just on the next
  // job.
  private markBusy(container: ManagedContainer): void {
    container.resourceBusyUntil = Date.now() + RESOURCE_BUSY_COOLDOWN_MS;
    this.forceScaleUp();
  }

  async acquire(waitTimeoutMs: number): Promise<ManagedContainer> {
    const withRoom = this.containers.filter((c) => this.hasSpareCapacity(c));
    if (withRoom.length > 0) {
      // Least-loaded first, EXCEPT when the host is already at its global
      // CPU budget (see ContainerPoolManager.hasGlobalCpuHeadroom()) and
      // some already-busy container still has room: adding a job to a
      // container already doing work doesn't increase how many containers
      // are simultaneously drawing real host CPU, but routing to a
      // currently-idle one does (it goes from drawing ~0 real CPU to
      // actively competing for a core). Confirmed by hand this distinction
      // matters: docker stats during a burst showed multiple containers
      // simultaneously pegged near their full CPU quota, collectively
      // oversubscribing the host, even though each one individually
      // stayed within ITS OWN cgroup limit.
      const alreadyBusyWithRoom = withRoom.filter((c) => c.activeJobs > 0);
      const candidates = alreadyBusyWithRoom.length > 0 && !this.hasGlobalCpuHeadroom() ? alreadyBusyWithRoom : withRoom;
      const chosen = candidates.reduce((a, b) => (a.activeJobs <= b.activeJobs ? a : b));
      chosen.activeJobs += 1;
      chosen.totalJobs += 1;
      chosen.lastUsedAt = Date.now();
      this.maybeScaleUp();
      return chosen;
    }

    // Spawning here would hand the job straight to a brand-new (idle ->
    // busy) container, exactly what hasGlobalCpuHeadroom() gates - see
    // forceScaleUp()'s comment. Skipping the spawn when over budget lets
    // this fall through to the waiter queue below instead.
    if (this.containers.length + this.starting < this.config.max && this.hasGlobalCpuHeadroom()) {
      const created = await this.spawnOne();
      if (created) {
        created.activeJobs += 1;
        created.totalJobs += 1;
        return created;
      }
    }

    // Every container, across the whole pool, is at its slot ceiling, and
    // the pool is at its container ceiling too — this is the only case
    // where a candidate actually waits, and only until *any* slot in *any*
    // container frees up (not "this specific container").
    return new Promise<ManagedContainer>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(onAvailable);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error('Timed out waiting for a free execution slot'));
      }, waitTimeoutMs);

      const onAvailable = (container: ManagedContainer): void => {
        clearTimeout(timer);
        container.activeJobs += 1;
        container.totalJobs += 1;
        container.lastUsedAt = Date.now();
        resolve(container);
      };
      this.waiters.push(onAvailable);
    });
  }

  // Synchronous, unlike the old per-job ping-based release() — freeing a
  // slot is just bookkeeping now; container health is verified by the
  // periodic sweep below instead of on every single job's critical path.
  release(container: ManagedContainer, healthy: boolean, resourceBusy = false): void {
    container.activeJobs = Math.max(0, container.activeJobs - 1);
    container.lastUsedAt = Date.now();
    if (!healthy) {
      this.markDead(container.id);
      return;
    }
    if (resourceBusy) {
      // Caller (codeExecutionWorker.ts) only ever sets this alongside
      // healthy=true — the container itself is fine, it just couldn't
      // admit this particular job right now. Cooldown, not destruction.
      this.markBusy(container);
      return;
    }
    if (container.totalJobs >= MAX_JOBS_PER_CONTAINER_LIFETIME) {
      // Drain, don't destroy: this container may still have other
      // concurrent candidates' jobs running on it right now (activeJobs
      // can be > 0 here — this is just the job that happened to push
      // totalJobs over the line, not necessarily the last one on it).
      // Immediately destroying it, the way an unhealthy container is,
      // would kill every other candidate still actively using it.
      // `retiring` excludes it from new job assignment (acquire()'s
      // withRoom filter); once every existing job on it finishes and
      // activeJobs reaches 0, the branch below actually removes it.
      container.retiring = true;
      if (container.activeJobs === 0) {
        this.markDead(container.id);
      }
      // A retiring-but-still-occupied container can't take on new work
      // itself, but its already-full slots aren't "freed" either — no
      // wakeWaiters() call needed for this branch specifically.
      this.maybeScaleUp();
      return;
    }
    this.wakeWaiters();
  }

  // Called both from release() (a job discovered its container is dead)
  // and from the periodic health sweep (a container went unresponsive with
  // nothing actively using it). Removes it from rotation immediately so no
  // further jobs get routed there, then replaces it in the background.
  markDead(containerId: string): void {
    const idx = this.containers.findIndex((c) => c.id === containerId);
    if (idx === -1) return;
    const [dead] = this.containers.splice(idx, 1);
    this.destroyById(dead.id).catch(() => {});
    this.spawnOne().catch((err) => console.error(`[codeExecPool:${this.language}] replacement spawn failed:`, err.message));
  }

  async healthSweep(): Promise<void> {
    await Promise.all(
      this.containers.map(async (c) => {
        try {
          const { status } = await httpGetJson(c.hostPort, '/health', HEALTH_CHECK_TIMEOUT_MS);
          if (status === 200) {
            c.consecutiveHealthFailures = 0;
            return;
          }
        } catch {
          // fall through - treated the same as a non-200 status below
        }
        c.consecutiveHealthFailures += 1;
        // A busy container gets more consecutive misses before being
        // declared dead than an idle one - see the threshold constants'
        // comment for why (real cgroup CPU contention from legitimate
        // work delays the health check right along with everything else).
        const threshold = c.activeJobs > 0 ? BUSY_HEALTH_FAILURE_THRESHOLD : IDLE_HEALTH_FAILURE_THRESHOLD;
        if (c.consecutiveHealthFailures >= threshold) this.markDead(c.id);
      })
    );
  }

  async scaleDownIdle(): Promise<void> {
    const cutoff = Date.now() - IDLE_SCALE_DOWN_MS;
    let removable = this.containers.length - this.config.min;
    if (removable <= 0) return;

    for (const c of [...this.containers]) {
      if (removable <= 0) break;
      if (c.activeJobs === 0 && c.lastUsedAt < cutoff) {
        removable -= 1;
        this.markDead(c.id);
      }
    }
  }

  private async destroyById(containerId: string): Promise<void> {
    try {
      await this.docker.getContainer(containerId).remove({ force: true });
    } catch {
      // already gone — fine
    }
  }

  invalidateAll(): void {
    const stale = this.containers;
    this.containers = [];
    for (const c of stale) this.destroyById(c.id).catch(() => {});
  }

  async shutdown(): Promise<void> {
    const all = [...this.containers];
    this.containers = [];
    await Promise.all(all.map((c) => this.destroyById(c.id)));
  }
}

class ContainerPoolManager {
  private readonly docker = new Docker();
  private readonly pools = new Map<string, LanguagePool>();
  private scaleDownTimer?: NodeJS.Timeout;
  private healthSweepTimer?: NodeJS.Timeout;
  // Populated from `docker info` at start() - 0 (unknown) until then.
  private hostCpuCores = 0;
  // Fraction of the host's REAL cores this whole code-exec system (every
  // language pool combined) is allowed to commit to SIMULTANEOUSLY-BUSY
  // containers at once. Deliberately not 1.0: leaves headroom for the host
  // OS, Postgres, Redis, the API server, and this worker process itself,
  // none of which run inside these containers' cgroups. Exists because
  // supervisor.py's own per-container admission gate (memory ratio, CPU
  // throttle rate) only ever sees ITS OWN container's cgroup - it has zero
  // visibility into sibling containers also drawing real CPU at the same
  // moment. Confirmed by hand: a 16-job burst spread across the python
  // pool's containers showed (via `docker stats` sampled live during the
  // burst) 6 containers simultaneously pegged near their full 2.0-CPU
  // quota each - about 7.5 real cores of demand on an 8-core host - purely
  // because each container's cgroup allocation is a CEILING on that
  // container, not a RESERVATION carved out of the shared host, so nothing
  // stopped multiple containers from each legitimately trying to use their
  // full allocation at once.
  private readonly hostCpuUtilizationCap = Number(process.env.CODE_EXEC_HOST_CPU_UTILIZATION_CAP || 0.85);

  configurePool(language: string, config: PoolConfig): void {
    if (!this.pools.has(language)) {
      this.pools.set(language, new LanguagePool(this.docker, language, config, () => this.hasGlobalCpuHeadroom()));
    }
  }

  // How many containers can be simultaneously BUSY (activeJobs > 0), across
  // every language pool combined, before the host's real CPU budget is
  // spoken for. Uses CONTAINER_CPU_CORES (every pool's containers share the
  // same per-container CPU allocation) rather than per-language accounting,
  // since a busy container of ANY language draws roughly the same real CPU.
  private globalBusyContainerBudget(): number {
    if (!this.hostCpuCores) return Number.MAX_SAFE_INTEGER; // unknown yet (pre-start()) - fail open, don't block startup
    return Math.max(1, Math.floor((this.hostCpuCores * this.hostCpuUtilizationCap) / CONTAINER_CPU_CORES));
  }

  private countGloballyBusyContainers(): number {
    let total = 0;
    for (const pool of this.pools.values()) total += pool.busyContainerCount();
    return total;
  }

  // Passed into every LanguagePool so its scale-up and container-selection
  // decisions can factor in host-wide load, not just their own pool's
  // bookkeeping - see LanguagePool.acquire()'s and forceScaleUp()'s use of
  // this.
  hasGlobalCpuHeadroom(): boolean {
    return this.countGloballyBusyContainers() < this.globalBusyContainerBudget();
  }

  private getPool(language: string): LanguagePool {
    const pool = this.pools.get(language);
    if (!pool) throw new Error(`No container pool configured for language "${language}"`);
    return pool;
  }

  // Deliberately NOT Internal:true — verified by hand that Docker doesn't
  // publish ports at all on an internal network (the supervisor was
  // completely unreachable from the host under that config), so this is a
  // normal bridge network. See the longer note next to CapAdd in
  // spawnOne(): this means candidate code currently has outbound network
  // access via the container's default route, an open item, not something
  // this network config actually closes off despite what an earlier
  // version of this comment claimed.
  private async ensureNetwork(): Promise<void> {
    try {
      await this.docker.createNetwork({
        Name: process.env.CODE_EXEC_DOCKER_NETWORK || 'talentq-code-exec-net',
        Driver: 'bridge',
      });
    } catch (err) {
      const message = (err as Error).message || '';
      if (!/already exists/i.test(message)) {
        throw err;
      }
    }
  }

  // Closes the network-egress gap left by using a non-Internal bridge (see
  // ensureNetwork()'s comment for why Internal:true had to be abandoned).
  // Runs a short-lived, --network host, --cap-add NET_ADMIN helper —
  // reusing the base image (it has iptables and nothing else this needs)
  // rather than pulling a second one — that installs
  // one rule in Docker's DOCKER-USER chain (the chain Docker guarantees it
  // will never overwrite) blocking any packet sourced from our sandbox
  // subnet, plus a higher-priority rule accepting established/related
  // traffic so responses to the worker's own inbound connections (to each
  // container's published supervisor port) aren't caught by the same
  // DROP. Verified by hand: candidate code's own outbound HTTP requests
  // get blocked (URLError), while /health and /run over the published
  // port keep working. Insertion order matters and is counterintuitive —
  // `iptables -I` always inserts at position 1, so inserting DROP *first*
  // and ESTABLISHED,RELATED *second* is what leaves ESTABLISHED,RELATED
  // evaluated first (on top) — reversing this insertion order silently
  // produces a chain that blocks the container's own responses too.
  //
  // Applies host-wide, not per-container — every container on this bridge
  // network shares the block, which is exactly the intent (nothing on
  // this network should ever reach the internet). Idempotent (`-C` check
  // before each `-I`) so repeated worker restarts don't accumulate
  // duplicate rules.
  private async applyEgressFirewall(): Promise<void> {
    const network = this.docker.getNetwork(process.env.CODE_EXEC_DOCKER_NETWORK || 'talentq-code-exec-net');
    const info = await network.inspect();
    const subnet = info.IPAM?.Config?.[0]?.Subnet;
    if (!subnet) {
      console.warn('[codeExecPool] could not determine network subnet — skipping egress firewall (candidate code may have internet access)');
      return;
    }

    const script = [
      `iptables -C DOCKER-USER -s ${subnet} -j DROP 2>/dev/null || iptables -I DOCKER-USER -s ${subnet} -j DROP`,
      `iptables -C DOCKER-USER -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER -m state --state ESTABLISHED,RELATED -j ACCEPT`,
    ].join(' && ');

    const helper = await this.docker.createContainer({
      Image: CODE_EXEC_BASE_IMAGE,
      Cmd: ['sh', '-c', script],
      HostConfig: {
        NetworkMode: 'host',
        CapAdd: ['NET_ADMIN'],
        AutoRemove: true,
      },
    });
    await helper.start();
    const waitResult = await helper.wait();
    if (waitResult.StatusCode !== 0) {
      console.warn(`[codeExecPool] egress firewall helper exited ${waitResult.StatusCode} — candidate code may have internet access`);
    } else {
      console.log(`[codeExecPool] egress firewall applied for ${subnet}`);
    }
  }

  async start(): Promise<void> {
    try {
      const info = await this.docker.info();
      this.hostCpuCores = info.NCPU || 0;
      if (this.hostCpuCores) {
        console.log(
          `[codeExecPool] host has ${this.hostCpuCores} CPU core(s); global busy-container budget = ${this.globalBusyContainerBudget()} (${(this.hostCpuUtilizationCap * 100).toFixed(0)}% utilization cap / ${CONTAINER_CPU_CORES} CPU per container)`
        );
      }
    } catch (err) {
      console.warn('[codeExecPool] could not determine host CPU count — global CPU-headroom gating disabled (fail open):', (err as Error).message);
    }

    await this.ensureNetwork();
    await this.applyEgressFirewall();
    await Promise.all(Array.from(this.pools.values(), (p) => p.prewarm()));

    this.scaleDownTimer = setInterval(() => {
      for (const pool of this.pools.values()) {
        pool.scaleDownIdle().catch((err) => console.error('[codeExecPool] scale-down error:', err.message));
      }
    }, IDLE_SCALE_DOWN_CHECK_MS);
    this.scaleDownTimer.unref();

    this.healthSweepTimer = setInterval(() => {
      for (const pool of this.pools.values()) {
        pool.healthSweep().catch((err) => console.error('[codeExecPool] health sweep error:', err.message));
      }
    }, HEALTH_CHECK_INTERVAL_MS);
    this.healthSweepTimer.unref();
  }

  async acquire(
    language: string,
    waitTimeoutMs = 8000
  ): Promise<{ id: string; hostPort: number; release: (healthy: boolean, resourceBusy?: boolean) => void }> {
    const pool = this.getPool(language);
    const container = await pool.acquire(waitTimeoutMs);
    return {
      id: container.id,
      hostPort: container.hostPort,
      release: (healthy: boolean, resourceBusy = false) => pool.release(container, healthy, resourceBusy),
    };
  }

  markDead(language: string, containerId: string): void {
    this.pools.get(language)?.markDead(containerId);
  }

  stats(): PoolStats[] {
    return Array.from(this.pools.values(), (p) => p.stats());
  }

  invalidatePool(language: string): void {
    this.pools.get(language)?.invalidateAll();
  }

  getDocker(): Docker {
    return this.docker;
  }

  async shutdown(): Promise<void> {
    if (this.scaleDownTimer) clearInterval(this.scaleDownTimer);
    if (this.healthSweepTimer) clearInterval(this.healthSweepTimer);
    await Promise.all(Array.from(this.pools.values(), (p) => p.shutdown()));
  }
}

export const containerPoolManager = new ContainerPoolManager();
