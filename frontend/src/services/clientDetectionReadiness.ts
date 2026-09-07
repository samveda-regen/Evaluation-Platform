// Bounded warm-up check for the two in-browser proctoring models (yolo26n
// object detection + MediaPipe gaze). Run once during the candidate's
// pre-exam system check (see SebTestInstructions.tsx) rather than lazily on
// the first analysis cycle — useProctoring.ts's runSnapshotAnalysis used to
// call loadClientVisionModel()/loadClientFaceMesh() on every cycle (every
// ~1s) for the rest of the exam whenever either one failed, since both
// loaders intentionally clear their cached promise on failure "to allow
// retry on next call". That's the right behavior for a transient hiccup, but
// with nothing bounding it a candidate whose browser can never load the
// model (WASM disabled, out of memory, blocked asset, or a load that simply
// hangs and never settles) paid for a full reload attempt every single
// second for the whole exam, with the analysis cycle itself able to hang
// indefinitely if a loader promise never settles at all.
//
// This runs the same two loaders once, capped at READINESS_TIMEOUT_MS, and
// returns a single true/false verdict. The caller (SebTestInstructions.tsx)
// persists that verdict as a one-way "forceServerDetection" flag in
// testStore for the rest of the attempt — useProctoring.ts checks it before
// ever calling either loader, so a failed/slow load is retried at most once,
// not every cycle. If either model fails, the whole session is pushed to
// server-side detection (not just the one that failed) — simpler than
// tracking the two models independently, at the cost of also giving up a
// model that would have worked on its own.
import { loadClientVisionModel } from './clientVisionService';
import { loadClientFaceMesh } from './clientFaceMeshService';

const READINESS_TIMEOUT_MS = 60000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('client detection readiness check timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function checkClientDetectionReadiness(): Promise<boolean> {
  try {
    await withTimeout(Promise.all([loadClientVisionModel(), loadClientFaceMesh()]), READINESS_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}
