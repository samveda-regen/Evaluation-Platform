// Client-side MediaPipe face landmarking for proctoring.
//
// This is the browser port of the FaceMesh half of python_cv_service/app.py
// (`_face_mesh` + `_gaze_signal`). Together with clientVisionService.ts (the
// yolo26n ONNX detector), it means a SEB session runs BOTH proctoring models
// locally: no frame round-trip to the Python service is needed for either
// object detection or gaze.
//
// Runs via @mediapipe/tasks-vision WASM. Both the WASM runtime and the model
// are served from this app's own origin (/mediapipe/, /models/) rather than
// Google's CDN — SEB locks navigation/network down to the exam host, so a
// CDN fetch is not reachable there.
//
//   WASM runtime: /mediapipe/vision_wasm_internal.{js,wasm} (+ nosimd variants)
//   Model:        /models/face_landmarker.task
//
// Landmark topology note: mp.solutions.face_mesh (server) and the Tasks
// FaceLandmarker (here) emit the same canonical 468-point face mesh, so the
// three indices the server's gaze math reads — 33 / 263 / 1 — refer to the
// same anatomical points in both. That is what makes this a port rather than
// a reimplementation.
//
// Known deviation from the server: app.py runs `_enhance_frame` (Y-channel
// histogram equalisation) before FaceMesh. That is not ported — it would mean
// an extra full-frame pixel pass in JS per cycle, and the Tasks face detector
// is a newer model than the one the solutions API used, so it is markedly
// less dependent on the pre-pass in low light. If low-light face loss shows up
// in the field, this is the first thing to revisit.

// Type-only import: erased at compile time. The runtime module is loaded
// dynamically in loadTasksVision() below, for the same reason
// clientVisionService.ts defers onnxruntime-web — a static top-level import
// runs the library's own init side effects on module load, before any
// try/catch in this file exists to contain them, and a throw there would take
// down every module that imports this one (including useProctoring.ts, which
// owns the camera preview and the rest of the analysis loop).
import type {
  FaceLandmarker as FaceLandmarkerType,
  NormalizedLandmark,
} from '@mediapipe/tasks-vision';

const WASM_BASE_PATH = '/mediapipe';
const MODEL_URL = '/models/face_landmarker.task';

// --- Constants ported from python_cv_service/app.py ---------------------
// max_num_faces=3 (app.py:239)
const MAX_FACES = 3;
// max(FACE_MIN_CONF, 0.65) with FACE_MIN_CONF defaulting to 0.45 (app.py:243-244)
const MIN_DETECTION_CONFIDENCE = 0.65;
const MIN_TRACKING_CONFIDENCE = 0.65;
// GAZE_LEFT_RIGHT_THRESHOLD default (app.py:114)
const GAZE_LEFT_RIGHT_THRESHOLD = 0.35;
// LOOK_AWAY_SECONDS default (app.py:110) — the server only emits looking_away
// once gaze has been off-screen this long, not on a single frame.
const LOOK_AWAY_SECONDS = 3.0;
// Mirrors app.py's GAP_RESET_THRESHOLD: if the gap since the previous
// observation is longer than the violation window itself, the candidate's
// gaze during that gap is unknown, so the timer must not carry across it.
const GAZE_GAP_RESET_SECONDS = LOOK_AWAY_SECONDS + 2.0;

// Landmark indices read by app.py's _gaze_signal (app.py:280-282)
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;
const NOSE_TIP = 1;

export type GazeDirection = 'center' | 'left' | 'right' | 'unknown';

export interface FaceMeshSignal {
  faceCount: number;
  gazeDirection: GazeDirection;
  /** 0-100, matching the rest of the app's convention. */
  gazeConfidence: number;
  isLookingAtScreen: boolean;
}

let tasksVisionPromise: Promise<typeof import('@mediapipe/tasks-vision')> | null = null;

function loadTasksVision(): Promise<typeof import('@mediapipe/tasks-vision')> {
  if (!tasksVisionPromise) {
    tasksVisionPromise = import('@mediapipe/tasks-vision').catch(err => {
      tasksVisionPromise = null; // allow retry on next call
      throw err;
    });
  }
  return tasksVisionPromise;
}

let landmarkerPromise: Promise<FaceLandmarkerType> | null = null;

export function loadClientFaceMesh(): Promise<FaceLandmarkerType> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, FaceLandmarker } = await loadTasksVision();
      // forVisionTasks picks the SIMD or nosimd build based on what the engine
      // reports; both are present under WASM_BASE_PATH so either choice
      // resolves locally. Unlike MediaPipe's threaded builds this needs no
      // SharedArrayBuffer, so it works without the COOP+COEP cross-origin
      // isolation headers this app doesn't set — same constraint that pins
      // onnxruntime-web to numThreads=1 in clientVisionService.ts.
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);

      const options = {
        baseOptions: { modelAssetPath: MODEL_URL },
        runningMode: 'VIDEO' as const,
        numFaces: MAX_FACES,
        minFaceDetectionConfidence: MIN_DETECTION_CONFIDENCE,
        minTrackingConfidence: MIN_TRACKING_CONFIDENCE,
        // Gaze reads three landmark coordinates only. Blendshapes and the
        // facial transform matrices are extra output the server never
        // computed either (refine_landmarks=False), so they stay off.
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      };

      // GPU is several times faster, but it needs a working WebGL context.
      // SEB ships its own Chromium/CEF build and may be running with GPU
      // acceleration disabled or software-rendered, in which case
      // createFromOptions throws during WebGL setup. Falling back to CPU
      // keeps gaze alive there instead of losing the signal entirely.
      try {
        return await FaceLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: 'GPU' as const },
        });
      } catch (gpuError) {
        console.warn('[proctor] FaceLandmarker GPU delegate unavailable, falling back to CPU:', gpuError);
        return await FaceLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: 'CPU' as const },
        });
      }
    })().catch(err => {
      landmarkerPromise = null; // allow retry rather than caching a permanent failure
      throw err;
    });
  }
  return landmarkerPromise;
}

// runningMode 'VIDEO' requires strictly increasing timestamps per landmarker
// instance; detectForVideo throws if one goes backwards or repeats. The
// analysis loop is interval-driven rather than frame-driven, so two cycles can
// land on the same performance.now() millisecond.
let lastVideoTimestamp = -1;

/**
 * One frame of face landmarking. Returns face count and the gaze verdict,
 * matching what app.py's `_face_mesh.process` + `_gaze_signal` pair produced
 * server-side for the same frame.
 */
export function runClientFaceMesh(
  landmarker: FaceLandmarkerType,
  source: HTMLVideoElement | HTMLCanvasElement
): FaceMeshSignal {
  const width = 'videoWidth' in source ? source.videoWidth : source.width;
  const height = 'videoHeight' in source ? source.videoHeight : source.height;
  if (!width || !height) {
    throw new Error('Source has no dimensions yet');
  }

  const timestamp = Math.max(performance.now(), lastVideoTimestamp + 1);
  lastVideoTimestamp = timestamp;

  const result = landmarker.detectForVideo(source, timestamp);
  const faces = result.faceLandmarks ?? [];
  if (faces.length === 0) {
    // app.py's _gaze_signal returns (True, "unknown", 0.0) with no face —
    // "not looking away" rather than "looking away", so that a missing face
    // is reported as face_not_detected and never doubles as a gaze violation.
    return { faceCount: 0, gazeDirection: 'unknown', gazeConfidence: 0, isLookingAtScreen: true };
  }

  const gaze = gazeFromLandmarks(faces[0]);
  return { faceCount: faces.length, ...gaze };
}

/** Direct port of app.py::_gaze_signal's landmark math (app.py:278-297). */
function gazeFromLandmarks(landmarks: NormalizedLandmark[]): Omit<FaceMeshSignal, 'faceCount'> {
  const leftEye = landmarks[LEFT_EYE_OUTER];
  const rightEye = landmarks[RIGHT_EYE_OUTER];
  const nose = landmarks[NOSE_TIP];
  if (!leftEye || !rightEye || !nose) {
    return { gazeDirection: 'unknown', gazeConfidence: 0, isLookingAtScreen: true };
  }

  const eyeWidth = Math.abs(rightEye.x - leftEye.x);
  if (eyeWidth < 1e-5) {
    return { gazeDirection: 'unknown', gazeConfidence: 0, isLookingAtScreen: true };
  }

  const eyeCenterX = (leftEye.x + rightEye.x) / 2;
  const relX = (nose.x - eyeCenterX) / eyeWidth;

  if (relX < -GAZE_LEFT_RIGHT_THRESHOLD) {
    return { gazeDirection: 'left', gazeConfidence: 80, isLookingAtScreen: false };
  }
  if (relX > GAZE_LEFT_RIGHT_THRESHOLD) {
    return { gazeDirection: 'right', gazeConfidence: 80, isLookingAtScreen: false };
  }
  return { gazeDirection: 'center', gazeConfidence: 85, isLookingAtScreen: true };
}

// --- Sustained-gaze gate -----------------------------------------------
// The server never emitted looking_away off a single frame: it tracked
// state["away_start"] per session and only raised the violation once gaze had
// been off-screen for LOOK_AWAY_SECONDS (app.py:624-628). The clientViolations
// path bypasses that state machine entirely, so the timer has to live here or
// a single glance would become a violation.

let awayStartMs: number | null = null;
let lastGazeObservationMs: number | null = null;

/** Call when a proctoring session starts or stops so timers don't leak across sessions. */
export function resetGazeTracking(): void {
  awayStartMs = null;
  lastGazeObservationMs = null;
  lastVideoTimestamp = -1;
}

/**
 * Feeds one gaze observation into the sustained-gaze timer and reports whether
 * the look-away window has now been exceeded.
 */
export function gazeSustainedAway(signal: FaceMeshSignal, nowMs: number = Date.now()): boolean {
  if (lastGazeObservationMs !== null && (nowMs - lastGazeObservationMs) / 1000 > GAZE_GAP_RESET_SECONDS) {
    awayStartMs = null;
  }
  lastGazeObservationMs = nowMs;

  // Only run the timer while a face is actually present, matching the
  // server's "only when a face exists" guard on the look-away branch.
  if (signal.faceCount === 0 || signal.gazeDirection === 'unknown' || signal.isLookingAtScreen) {
    awayStartMs = null;
    return false;
  }

  if (awayStartMs === null) {
    awayStartMs = nowMs;
    return false;
  }

  if ((nowMs - awayStartMs) / 1000 > LOOK_AWAY_SECONDS) {
    // Re-arm from now so the next window is measured fresh instead of
    // emitting on every subsequent cycle (app.py resets away_start on emit).
    awayStartMs = nowMs;
    return true;
  }

  return false;
}

export const FACE_MESH_TUNING = {
  GAZE_LEFT_RIGHT_THRESHOLD,
  LOOK_AWAY_SECONDS,
  MAX_FACES,
} as const;
