// Bounded warm-up check for the two in-browser proctoring models (yolo26n
// object detection + MediaPipe gaze). Run once, directly before the
// assessment renders (see SebTestStart.tsx), rather than lazily on the first
// analysis cycle — useProctoring.ts's runSnapshotAnalysis used to call
// loadClientVisionModel()/loadClientFaceMesh() on every cycle (every ~1s)
// for the rest of the exam whenever either one failed, since both loaders
// intentionally clear their cached promise on failure "to allow retry on
// next call". That's the right behavior for a transient hiccup, but with
// nothing bounding it a candidate whose browser can never load the model
// (WASM disabled, out of memory, blocked asset, or a load that simply hangs
// and never settles) paid for a full reload attempt every single second for
// the whole exam, with the analysis cycle itself able to hang indefinitely
// if a loader promise never settles at all.
//
// Loading the model is only half the cost, though: onnxruntime-web and
// MediaPipe's WASM runtimes also pay a one-time graph-compilation cost on
// the FIRST REAL INFERENCE call, separate from loading — observed as a
// 15-20s stall on the exam's first detection cycle even with the model
// already loaded. `primeSource`, when given a real video frame (the
// candidate's own camera — already granted by the time this runs, see
// SebTestStart.tsx), runs one real inference pass through each model so
// that cost is paid here, on the loading screen, instead of during the exam.
//
// Returns a single true/false verdict, capped at READINESS_TIMEOUT_MS total
// (loading + priming together). The caller persists that verdict as a
// one-way "forceServerDetection" flag in testStore for the rest of the
// attempt — useProctoring.ts checks it before ever calling either loader, so
// a failed/slow load is retried at most once, not every cycle. If either
// model fails, the whole session is pushed to server-side detection (not
// just the one that failed) — simpler than tracking the two models
// independently, at the cost of also giving up a model that would have
// worked on its own.
import { loadClientVisionModel, runClientDetection } from './clientVisionService';
import { loadClientFaceMesh, runClientFaceMesh } from './clientFaceMeshService';

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

export async function checkClientDetectionReadiness(
  primeSource?: HTMLVideoElement | HTMLCanvasElement,
): Promise<boolean> {
  try {
    await withTimeout(
      (async () => {
        const [session, landmarker] = await Promise.all([loadClientVisionModel(), loadClientFaceMesh()]);
        if (!primeSource) return;
        // Both run best-effort — a priming failure (e.g. a still-black frame)
        // shouldn't fail the whole readiness check; the model is loaded either
        // way, which is what actually matters for the exam to proceed. Run
        // together rather than sequentially since they're independent models.
        await Promise.all([
          runClientDetection(session, primeSource).catch(() => {}),
          (async () => {
            try {
              runClientFaceMesh(landmarker, primeSource);
            } catch {
              // ignore — see above
            }
          })(),
        ]);
      })(),
      READINESS_TIMEOUT_MS,
    );
    return true;
  } catch {
    return false;
  }
}
