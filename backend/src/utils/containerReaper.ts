import Docker from 'dockerode';
import { CODE_EXEC_LABEL } from './dockerSandbox.js';

const docker = new Docker();

// Backstop for containers that survive both the in-container `timeout`
// self-kill and the Node-side wrapper's own timeout race — e.g. a worker
// process that crashed mid-execution before it could call container.remove().
// Anything labeled as ours and older than maxAgeMs is force-removed.
export async function reapStaleContainers(maxAgeMs: number): Promise<number> {
  const containers = await docker.listContainers({
    all: true,
    filters: JSON.stringify({ label: [`${CODE_EXEC_LABEL}=true`] }),
  });

  const cutoff = Date.now() - maxAgeMs;
  let reaped = 0;

  for (const info of containers) {
    const startedAtLabel = info.Labels?.['talentq.startedAt'];
    const startedAt = startedAtLabel ? new Date(startedAtLabel).getTime() : 0;
    if (!startedAt || startedAt < cutoff) {
      try {
        await docker.getContainer(info.Id).remove({ force: true });
        reaped += 1;
      } catch {
        // already gone, or being removed concurrently — fine either way
      }
    }
  }

  return reaped;
}

let reaperInterval: NodeJS.Timeout | undefined;

export function startContainerReaper(intervalMs: number, maxAgeMs: number): void {
  if (reaperInterval) return;
  reaperInterval = setInterval(() => {
    reapStaleContainers(maxAgeMs).catch((err) => console.error('Container reaper error:', err));
  }, intervalMs);
  reaperInterval.unref();
}

export function stopContainerReaper(): void {
  if (reaperInterval) {
    clearInterval(reaperInterval);
    reaperInterval = undefined;
  }
}
