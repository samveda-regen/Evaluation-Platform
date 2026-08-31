// Client-side proctoring inference. Runs the exp-1 ONNX model directly in the
// candidate's browser via onnxruntime-web, replacing per-frame uploads to
// python_cv_service. Model I/O confirmed via `onnxruntime` on the model file
// directly (not assumed from the Python service, which loads it through
// ultralytics and never needed to know the raw shape):
//   input  "images": float32 [1, 3, 640, 640]
//   output "output0": float32 [1, 300, 6]  (already NMS'd: x1,y1,x2,y2,score,cls)
//
// Class map (python_cv_service/video_proctoring_test.py, app.py comment):
//   0 head phones, 1 laptop, 2 looking down, 3 looking left, 4 looking right,
//   5 looking straight, 6 looking up, 7 mobile phones, 8 note books,
//   9 person, 10 tv

// Gaze comes from MediaPipe rather than from this model's own gaze classes
// wherever MediaPipe has a face to work with — see clientFaceMeshService.ts,
// which runs the FaceLandmarker in-browser via @mediapipe/tasks-vision WASM
// and is the port of the server's FaceMesh gaze path. detectionsToViolations
// takes that signal as an optional second argument and gives it precedence;
// the exp-1 gaze classes below stay in as the fallback for cycles where
// MediaPipe found no face or failed to load. See the precedence note there.

// Type-only import: erased at compile time, no runtime side effect. The
// actual onnxruntime-web module is loaded dynamically inside loadOrt()
// below, guarded by try/catch — a static top-level `import * as ort from
// 'onnxruntime-web'` runs its side effects immediately on module load,
// before any of this file's try/catch blocks exist to catch it. If that
// library throws during its own init in some particular browser engine
// (unverified so far specifically inside SEB's bundled CEF/Chromium), a
// static import would crash the whole module graph that imports this file
// — including useProctoring.ts, which also owns the camera preview and the
// rest of the analysis loop, not just this feature.
import type * as OrtNamespace from 'onnxruntime-web';
import { gazeSustainedAway, type FaceMeshSignal } from './clientFaceMeshService';

const MODEL_URL = '/models/exp-1.onnx';
const INPUT_SIZE = 640;
const SCORE_THRESHOLD = 0.5;

let ortModulePromise: Promise<typeof OrtNamespace> | null = null;

function loadOrt(): Promise<typeof OrtNamespace> {
  if (!ortModulePromise) {
    ortModulePromise = import('onnxruntime-web')
      .then(ort => {
        ort.env.wasm.wasmPaths = '/ort/';
        // Single-threaded: avoids requiring SharedArrayBuffer / COOP+COEP
        // cross-origin isolation headers, which this app doesn't set.
        ort.env.wasm.numThreads = 1;
        return ort;
      })
      .catch(err => {
        ortModulePromise = null; // allow retry on next call
        throw err;
      });
  }
  return ortModulePromise;
}

const CLASS_NAMES = [
  'headphones', 'laptop', 'looking_down', 'looking_left', 'looking_right',
  'looking_straight', 'looking_up', 'mobile_phone', 'notebook', 'person', 'tv',
] as const;

const GAZE_AWAY_CLASSES = new Set([2, 3, 4, 6]); // down/left/right/up
const GAZE_STRAIGHT_CLASS = 5;
const PHONE_CLASS = 7;
const SECONDARY_SCREEN_CLASSES = new Set([1, 10]); // laptop, tv
const UNAUTHORIZED_OBJECT_CLASSES = new Set([0, 8]); // headphones, notebook
const PERSON_CLASS = 9;

export interface RawDetection {
  classId: number;
  className: string;
  score: number; // 0-1
  box: [number, number, number, number]; // x1,y1,x2,y2 in model input space
}

export interface ClientViolation {
  eventType: string;
  confidence: number; // 0-100, matching the rest of the app's convention
  description: string;
  metadata?: Record<string, unknown>;
}

let sessionPromise: Promise<OrtNamespace.InferenceSession> | null = null;

export function loadClientVisionModel(): Promise<OrtNamespace.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = loadOrt()
      .then(ort => ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      }))
      .catch(err => {
        sessionPromise = null; // allow retry on next call rather than caching a permanent failure
        throw err;
      });
  }
  return sessionPromise;
}

// Letterbox-resize a video frame into a square INPUT_SIZE canvas the same way
// video_proctoring_test.py's OpenCV preprocessing does: preserve aspect
// ratio, pad the rest with neutral gray (114,114,114).
function letterboxToTensor(
  ort: typeof OrtNamespace,
  source: HTMLVideoElement | HTMLCanvasElement
): OrtNamespace.Tensor {
  const srcWidth = 'videoWidth' in source ? source.videoWidth : source.width;
  const srcHeight = 'videoHeight' in source ? source.videoHeight : source.height;
  if (!srcWidth || !srcHeight) {
    throw new Error('Source has no dimensions yet');
  }

  const scale = Math.min(INPUT_SIZE / srcWidth, INPUT_SIZE / srcHeight);
  const drawWidth = Math.round(srcWidth * scale);
  const drawHeight = Math.round(srcHeight * scale);
  const padX = Math.floor((INPUT_SIZE - drawWidth) / 2);
  const padY = Math.floor((INPUT_SIZE - drawHeight) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not acquire 2D canvas context');

  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(source, 0, 0, srcWidth, srcHeight, padX, padY, drawWidth, drawHeight);

  const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const chw = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const plane = INPUT_SIZE * INPUT_SIZE;
  for (let i = 0; i < plane; i++) {
    const px = i * 4;
    chw[i] = data[px] / 255;             // R
    chw[plane + i] = data[px + 1] / 255; // G
    chw[2 * plane + i] = data[px + 2] / 255; // B
  }

  return new ort.Tensor('float32', chw, [1, 3, INPUT_SIZE, INPUT_SIZE]);
}

export async function runClientDetection(
  session: OrtNamespace.InferenceSession,
  source: HTMLVideoElement | HTMLCanvasElement
): Promise<RawDetection[]> {
  const ort = await loadOrt();
  const inputTensor = letterboxToTensor(ort, source);
  const feeds: Record<string, OrtNamespace.Tensor> = { images: inputTensor };
  const results = await session.run(feeds);
  const output = results.output0;
  if (!output) return [];

  const dets: RawDetection[] = [];
  const rows = output.dims[1] ?? 0;
  const cols = output.dims[2] ?? 6;
  const dataArr = output.data as Float32Array;
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    const score = dataArr[base + 4];
    if (score < SCORE_THRESHOLD) continue;
    const classId = Math.round(dataArr[base + 5]);
    dets.push({
      classId,
      className: CLASS_NAMES[classId] || `class_${classId}`,
      score,
      box: [dataArr[base], dataArr[base + 1], dataArr[base + 2], dataArr[base + 3]],
    });
  }
  return dets;
}

// Aggregates one frame's raw detections into violation events, matching the
// eventType vocabulary the backend already understands (proctorAIService.ts's
// TRUST_EVENT_WEIGHT_MAP / VIOLATION_SEVERITY_MAP). One event max per
// category per cycle — the backend's own cooldown (canStoreViolationNow)
// handles cross-cycle deduping, this just avoids stacking duplicates from a
// single frame's multiple overlapping boxes.
//
// `faceMesh` is this cycle's MediaPipe result (clientFaceMeshService.ts) when
// one is available. Pass it and gaze is decided by MediaPipe; omit it (or pass
// null, e.g. the landmarker is still loading or threw) and gaze falls back to
// exp-1's own gaze classes. Face/person counting always stays with exp-1
// either way — the server counted people with YOLO too, and MediaPipe only
// sees faces, so a candidate turned fully away is a person to one model and no
// face to the other. Its face count rides along in the metadata instead.
export function detectionsToViolations(
  dets: RawDetection[],
  faceMesh?: FaceMeshSignal | null
): ClientViolation[] {
  const violations: ClientViolation[] = [];
  const byClass = new Map<number, RawDetection>();
  for (const d of dets) {
    const existing = byClass.get(d.classId);
    if (!existing || existing.score < d.score) byClass.set(d.classId, d);
  }

  // MediaPipe's own face count is recorded alongside exp-1's person count
  // rather than driving the event, so a reviewer can see when the two models
  // disagreed (person but no face = candidate turned away or occluded).
  const faceCountMeta = faceMesh ? { mediapipeFaceCount: faceMesh.faceCount } : {};

  const personCount = dets.filter(d => d.classId === PERSON_CLASS).length;
  if (personCount === 0) {
    violations.push({
      eventType: 'face_not_detected',
      confidence: 80,
      description: 'No person detected in frame',
      metadata: { ...faceCountMeta },
    });
  } else if (personCount >= 2) {
    const best = dets.filter(d => d.classId === PERSON_CLASS).sort((a, b) => b.score - a.score)[0];
    violations.push({
      eventType: 'multiple_faces',
      confidence: Math.round(best.score * 100),
      description: `${personCount} people detected in frame`,
      metadata: { personCount, ...faceCountMeta },
    });
  }

  const phone = byClass.get(PHONE_CLASS);
  if (phone) {
    violations.push({
      eventType: 'phone_detected',
      confidence: Math.round(phone.score * 100),
      description: 'Mobile phone detected',
    });
  }

  for (const classId of SECONDARY_SCREEN_CLASSES) {
    const det = byClass.get(classId);
    if (det) {
      violations.push({
        eventType: 'secondary_monitor_detected',
        confidence: Math.round(det.score * 100),
        description: `${det.className} detected near candidate`,
      });
      break; // one is enough to flag
    }
  }

  for (const classId of UNAUTHORIZED_OBJECT_CLASSES) {
    const det = byClass.get(classId);
    if (det) {
      violations.push({
        eventType: 'unauthorized_object_detected',
        confidence: Math.round(det.score * 100),
        description: `${det.className} detected`,
      });
    }
  }

  // Gaze — MediaPipe first, exp-1's gaze classes as fallback.
  //
  // MediaPipe is preferred because it is what the server used: gaze there came
  // from FaceMesh landmark geometry, never from YOLO's gaze classes, so
  // routing through it keeps the client's verdicts comparable to the frames
  // that still go to python_cv_service (the fallback path in useProctoring.ts).
  // It also carries the server's sustained-gaze requirement — a single
  // off-screen frame is not a violation, LOOK_AWAY_SECONDS of them is —
  // which the exp-1 class path has no notion of.
  if (faceMesh && faceMesh.faceCount > 0 && faceMesh.gazeDirection !== 'unknown') {
    if (gazeSustainedAway(faceMesh)) {
      violations.push({
        eventType: 'looking_away',
        confidence: Math.round(faceMesh.gazeConfidence),
        description: `Candidate looking ${faceMesh.gazeDirection} (sustained)`,
        metadata: {
          source: 'mediapipe',
          gazeDirection: faceMesh.gazeDirection,
          faceCount: faceMesh.faceCount,
        },
      });
    }
  } else {
    // Take whichever gaze class had the single highest score this frame.
    const gazeClasses = [...GAZE_AWAY_CLASSES, GAZE_STRAIGHT_CLASS];
    const gazeDetections = dets.filter(d => gazeClasses.includes(d.classId));
    if (gazeDetections.length > 0) {
      const bestGaze = gazeDetections.sort((a, b) => b.score - a.score)[0];
      if (GAZE_AWAY_CLASSES.has(bestGaze.classId)) {
        violations.push({
          eventType: 'looking_away',
          confidence: Math.round(bestGaze.score * 100),
          description: `Candidate ${bestGaze.className.replace('_', ' ')}`,
          metadata: { source: 'exp-1' },
        });
      }
    }
  }

  return violations;
}
