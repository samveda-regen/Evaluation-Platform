// Client-side proctoring inference. Runs yolo26n.onnx (standard COCO-80
// object detector) directly in the candidate's browser via onnxruntime-web,
// replacing per-frame uploads to python_cv_service — same model file the
// server itself loads (python_cv_service/app.py's YOLO_MODEL_PATH), so
// client and server detection are the same model. Model I/O confirmed via
// `onnxruntime` on the model file directly:
//   input  "images": float32 [1, 3, 640, 640]
//   output "output0": float32 [1, 300, 6]  (already NMS'd: x1,y1,x2,y2,score,cls)
//
// This replaces the earlier exp-1.onnx custom model, which had its own
// Person/Laptop/Mobile Phones/TV/Note Books/Head Phones/gaze classes. COCO
// has no gaze classes and no "headphones" class — gaze is MediaPipe-only now
// (see below), and headphones detection has no equivalent, dropped rather
// than mapped to a misleading proxy. "Note books" maps to COCO's "book",
// the closest visual analog.

// Gaze comes entirely from MediaPipe FaceLandmarker — see
// clientFaceMeshService.ts, which runs it in-browser via
// @mediapipe/tasks-vision WASM and is the port of the server's FaceMesh gaze
// path (gaze never came from YOLO server-side either, exp-1's gaze classes
// were a client-only stopgap that no longer exists once the model is COCO).
// detectionsToViolations' second argument carries that signal; when it's
// absent (landmarker still loading, no face this cycle, or it threw) there is
// simply no gaze verdict for that cycle — no class-based fallback anymore.

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

const MODEL_URL = '/models/yolo26n.onnx';
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

// Standard COCO-80 class order — matches yolo26n.onnx's embedded metadata
// (confirmed via onnxruntime's get_modelmeta on the model file directly).
const CLASS_NAMES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck',
  'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
  'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
  'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
  'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
  'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
  'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
  'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
  'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier',
  'toothbrush',
] as const;

const PERSON_CLASS = 0;
const PHONE_CLASS = 67; // cell phone
const SECONDARY_SCREEN_CLASSES = new Set([62, 63]); // tv, laptop
// "book" is the closest COCO analog to exp-1's "note books" class; COCO has
// no headphones equivalent, so that detection is dropped rather than mapped
// to a misleading proxy (matches python_cv_service/app.py's
// UNAUTHORIZED_OBJECT_LABELS, which also only ever mapped "laptop").
const UNAUTHORIZED_OBJECT_CLASSES = new Set([73]); // book

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

  // Gaze — MediaPipe only. COCO has no gaze classes (unlike exp-1.onnx, which
  // had its own looking_left/right/up/down/straight classes as a client-only
  // stopgap); the server never used YOLO for gaze either, always FaceMesh.
  // If MediaPipe has no face this cycle (still loading, threw, or genuinely no
  // face), there is simply no gaze verdict for that cycle — no fallback.
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
  }

  return violations;
}
