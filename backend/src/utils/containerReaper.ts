import Docker from 'dockerode';
import http from 'http';
import { CODE_EXEC_LABEL, SUPERVISOR_PORT } from '../services/codeExec/pool.js';

// Safety net, not the primary lifecycle path: pool.ts owns and removes its
// own containers during normal operation, and its warm containers are
// meant to live for the whole worker process's lifetime (hours), so there
// is no "older than N minutes = stale" rule that would be safe to run on a
// recurring timer here — it would kill perfectly healthy warm containers
// right along with actually-orphaned ones.
//
// What this covers instead: a worker process that got killed (crash, `kill
// -9`, host reboot) leaves its containers running with nothing left to
// reap them, since pool.ts's cleanup lives in that same dead process. Call
// this once, at worker startup, before pool.start() prewarms.
//
// Does NOT assume every labeled container is unowned just because THIS
// process's own in-memory pool state is empty at startup - that used to be
// the assumption here, and it was wrong: confirmed by hand that starting a
// second codeExecutionWorker.js process while a first one was still alive
// force-removed all 13 of the first process's live, in-use containers
// (including ones with candidate jobs actively running on them), purely
// because this function had no way to tell "orphaned - owning process is
// dead" apart from "owned by a different worker process that's still very
// much alive." A container whose supervisor still answers /health belongs
// to SOMEONE, live, right now - leave it alone. Only containers that don't
// respond (the process that owned them really is gone) get reaped.
export async function reapOrphanedContainers(docker: Docker): Promise<number> {
  const containers = await docker.listContainers({
    all: true,
    filters: JSON.stringify({ label: [`${CODE_EXEC_LABEL}=true`] }),
  });

  let reaped = 0;
  for (const info of containers) {
    if (info.State === 'running' && (await isSupervisorResponsive(info))) {
      continue; // alive and answering - some other live process owns this one
    }
    try {
      await docker.getContainer(info.Id).remove({ force: true });
      reaped += 1;
    } catch {
      // already gone, or being removed concurrently — fine either way
    }
  }

  return reaped;
}

function isSupervisorResponsive(info: Docker.ContainerInfo): Promise<boolean> {
  const hostPort = info.Ports?.find((p) => p.PrivatePort === SUPERVISOR_PORT && p.PublicPort)?.PublicPort;
  // Can't verify liveness without a published port to probe - treat as
  // orphaned (matches the old, conservative default of reaping it) rather
  // than leaving an unverifiable container around forever.
  if (!hostPort) return Promise.resolve(false);

  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: hostPort, path: '/health', timeout: 1000 }, (res) => {
      res.resume(); // drain so the socket can close cleanly
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.on('close', () => resolve(false)); // covers the timeout-destroy path too, harmless if already resolved
  });
}
