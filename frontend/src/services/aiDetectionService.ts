/**
 * AI Detection Service using TensorFlow.js
 *
 * Uses:
 * - COCO-SSD: YOLO-based object detection (phones, people, etc.)
 * - face-api.js: Face detection, landmarks, expressions
 * - BlazeFace: Fast face detection
 *
 * Install dependencies:
 * npm install @tensorflow/tfjs @tensorflow-models/coco-ssd @tensorflow-models/blazeface face-api.js
 */

import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import * as blazeface from '@tensorflow-models/blazeface';

// Types
export interface DetectionResult {
  faces: FaceDetection[];
  objects: ObjectDetection[];
  violations: ViolationResult[];
}

export interface FaceDetection {
  confidence: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  landmarks?: { leftEye: number[]; rightEye: number[]; nose: number[]; mouth: number[] };
  isLookingAtScreen: boolean;
  gazeDirection: 'center' | 'left' | 'right' | 'up' | 'down';
}

export interface ObjectDetection {
  class: string;
  confidence: number;
  boundingBox: { x: number; y: number; width: number; height: number };
}

export interface ViolationResult {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  description: string;
}

/**
 * Returns true on devices that are too weak to run COCO-SSD in real-time.
 * On low-end devices we load only BlazeFace (fast, <5ms) and skip COCO-SSD (~150ms).
 * Candidates still get face/gaze detection; phone detection is handled by the Python service.
 */
function isLowEndDevice(): boolean {
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as any).deviceMemory || 2; // in GB, not available in all browsers
  return cores < 4 || memory < 4;
}

/** Races a promise against a timeout; returns null on timeout instead of throwing. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]).catch(() => null);
}

// Suspicious objects to detect (COCO-SSD classes)
const SUSPICIOUS_OBJECTS = [
  'cell phone',
  'laptop',
  'tv',
  'remote',
  'book',
  'clock',
];

const PERSON_CLASS = 'person';

/**
 * AI Proctor Class - Handles all ML-based detection
 */
export class AIProctor {
  private cocoModel: cocoSsd.ObjectDetection | null = null;
  private blazefaceModel: blazeface.BlazeFaceModel | null = null;
  private isInitialized = false;
  private isLowEnd = false;
  private noFaceFrameCount = 0;
  private lookAwayFrameCount = 0;
  private initPromise: Promise<boolean> | null = null;

  /**
   * Initialize TensorFlow.js and load models.
   * On low-end devices (< 4 CPU cores or < 4 GB RAM) COCO-SSD is skipped —
   * only BlazeFace is loaded. Phone/object detection falls back to the Python service.
   * Both model loads are wrapped with an 8-second timeout to avoid hanging indefinitely.
   *
   * Idempotent: safe to call from multiple places (e.g. an early warm-up on the
   * instructions page, then again when the assessment page mounts) — a second call
   * resolves immediately if already initialized, or joins the in-flight load rather
   * than reloading the models and re-triggering the WebGL shader-compile freeze.
   */
  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<boolean> {
    try {
      this.isLowEnd = isLowEndDevice();
      console.log(`Initializing AI Proctor (low-end device: ${this.isLowEnd})...`);

      await tf.setBackend('webgl');
      await tf.ready();
      console.log('TensorFlow.js ready with backend:', tf.getBackend());

      // Skip COCO-SSD on low-end devices — it's too heavy (~150ms per frame on CPU).
      // BlazeFace alone handles face/gaze detection (< 5ms per frame).
      if (!this.isLowEnd) {
        console.log('Loading COCO-SSD model...');
        this.cocoModel = await withTimeout(
          cocoSsd.load({ base: 'lite_mobilenet_v2' }),
          8000
        );
        if (this.cocoModel) {
          console.log('COCO-SSD model loaded');
        } else {
          console.warn('COCO-SSD load timed out — object detection disabled for this session');
        }
      }

      console.log('Loading BlazeFace model...');
      this.blazefaceModel = await withTimeout(blazeface.load(), 8000);
      if (!this.blazefaceModel) {
        console.warn('BlazeFace load timed out');
      }

      this.isInitialized = this.blazefaceModel !== null;
      console.log(`AI Proctor initialized (coco=${!!this.cocoModel}, blaze=${!!this.blazefaceModel})`);
      // On failure, clear initPromise so a later call (e.g. TestInterface mount, after
      // an early warm-up attempt failed) retries instead of replaying the same failure.
      if (!this.isInitialized) this.initPromise = null;
      return this.isInitialized;
    } catch (error) {
      console.error('Failed to initialize AI Proctor:', error);
      this.initPromise = null;
      return false;
    }
  }

  /**
   * Run detection on video frame
   */
  async detect(video: HTMLVideoElement): Promise<DetectionResult> {
    if (!this.isInitialized || !this.blazefaceModel) {
      throw new Error('AI Proctor not initialized');
    }

    const faces: FaceDetection[] = [];
    const objects: ObjectDetection[] = [];
    const violations: ViolationResult[] = [];

    // Run face detection with BlazeFace
    const faceDetections = await this.blazefaceModel.estimateFaces(video, false);

    for (const face of faceDetections) {
      const topLeft = face.topLeft as [number, number];
      const bottomRight = face.bottomRight as [number, number];
      const landmarks = face.landmarks as number[][];

      const faceResult: FaceDetection = {
        confidence: (face.probability as unknown as number[])[0] * 100,
        boundingBox: {
          x: topLeft[0],
          y: topLeft[1],
          width: bottomRight[0] - topLeft[0],
          height: bottomRight[1] - topLeft[1],
        },
        landmarks: landmarks ? {
          leftEye: landmarks[1],
          rightEye: landmarks[0],
          nose: landmarks[2],
          mouth: [(landmarks[3][0] + landmarks[4][0]) / 2, (landmarks[3][1] + landmarks[4][1]) / 2],
        } : undefined,
        isLookingAtScreen: true,
        gazeDirection: 'center',
      };

      // Estimate head pose (proxy for gaze direction) from the nose's position relative
      // to the eye line, normalized by inter-eye distance. This is scale-invariant — it
      // works the same regardless of distance from the camera or where the face happens
      // to sit in the video frame. Looking straight ahead keeps the nose roughly midway
      // between the eyes horizontally, and a fixed ratio below the eye line vertically;
      // turning the head to either side or tilting up/down shifts the nose off that
      // baseline. (Previously this checked where the face's bounding box sat within the
      // whole video frame, which only caught someone leaning their entire head far enough
      // to shift the box by 20%+ of the frame — it never caught a normal head turn/glance
      // to the side while staying centered on camera, which is why it rarely fired.)
      // Only trust the landmark geometry on a reasonably confident face detection —
      // low-confidence frames (motion blur, poor lighting, partial occlusion) give noisy
      // landmark positions that would otherwise produce false left/right/up triggers.
      if (landmarks && landmarks.length >= 3 && faceResult.confidence >= 60) {
        const [rightEye, leftEye, nose] = landmarks;
        const eyeMidX = (leftEye[0] + rightEye[0]) / 2;
        const eyeMidY = (leftEye[1] + rightEye[1]) / 2;
        const eyeDistance = Math.hypot(rightEye[0] - leftEye[0], rightEye[1] - leftEye[1]) || 1;

        const horizontalRatio = (nose[0] - eyeMidX) / eyeDistance;
        const verticalRatio = (nose[1] - eyeMidY) / eyeDistance;

        const H_THRESHOLD = 0.25;
        const V_NEUTRAL = 0.5;
        const V_THRESHOLD = 0.28;

        // Looking down (e.g. at the keyboard or notes on the desk) is normal exam
        // behavior and isn't flagged — only left/right/up count as "looking away",
        // since those are the directions someone would look at another screen,
        // a person, or something posted above their monitor.
        if (Math.abs(horizontalRatio) > H_THRESHOLD) {
          faceResult.gazeDirection = horizontalRatio > 0 ? 'left' : 'right';
          faceResult.isLookingAtScreen = false;
        } else if (verticalRatio < V_NEUTRAL - V_THRESHOLD) {
          faceResult.gazeDirection = 'up';
          faceResult.isLookingAtScreen = false;
        } else {
          faceResult.gazeDirection = verticalRatio > V_NEUTRAL + V_THRESHOLD ? 'down' : 'center';
          faceResult.isLookingAtScreen = true;
        }
      }

      faces.push(faceResult);
    }

    // Run object detection with COCO-SSD (YOLO-based).
    // Skipped on low-end devices where cocoModel was not loaded — phone/object
    // detection for those sessions is handled exclusively by the Python CV service.
    let personCount = 0;
    if (this.cocoModel) {
      const objectDetections = await this.cocoModel.detect(video);

      for (const obj of objectDetections) {
        const detection: ObjectDetection = {
          class: obj.class,
          confidence: obj.score * 100,
          boundingBox: {
            x: obj.bbox[0],
            y: obj.bbox[1],
            width: obj.bbox[2],
            height: obj.bbox[3],
          },
        };
        objects.push(detection);

        // Count people
        if (obj.class === PERSON_CLASS) {
          personCount++;
        }

        // Check for suspicious objects (lower threshold so phones at angle/distance are caught)
        if (SUSPICIOUS_OBJECTS.includes(obj.class) && obj.score > 0.3) {
          violations.push({
            type: `${obj.class}_detected`,
            severity: obj.class === 'cell phone' ? 'critical' : 'high',
            confidence: obj.score * 100,
            description: `${obj.class} detected in frame`,
          });
        }
      }
    }

    // Check for face-related violations
    if (faces.length === 0) {
      this.noFaceFrameCount++;
      if (this.noFaceFrameCount >= 3) {
        violations.push({
          type: 'face_not_detected',
          severity: 'high',
          confidence: 95,
          description: 'No face detected in camera frame',
        });
      }
    } else {
      this.noFaceFrameCount = 0;
    }

    // Multiple faces detected
    if (faces.length > 1 || personCount > 1) {
      violations.push({
        type: 'multiple_faces',
        severity: 'critical',
        confidence: 90,
        description: `Multiple people detected (${Math.max(faces.length, personCount)})`,
      });
    }

    // Looking away detection
    if (faces.length > 0 && !faces[0].isLookingAtScreen) {
      this.lookAwayFrameCount++;
      if (this.lookAwayFrameCount >= 5) {
        violations.push({
          type: 'looking_away',
          severity: 'medium',
          confidence: 80,
          description: `Looking ${faces[0].gazeDirection}`,
        });
      }
    } else {
      this.lookAwayFrameCount = 0;
    }

    return { faces, objects, violations };
  }

  /**
   * Capture snapshot with detection overlay
   */
  async captureWithOverlay(video: HTMLVideoElement): Promise<string> {
    const result = await this.detect(video);

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;

    // Draw video frame
    ctx.drawImage(video, 0, 0);

    // Draw face bounding boxes (green)
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    for (const face of result.faces) {
      ctx.strokeRect(
        face.boundingBox.x,
        face.boundingBox.y,
        face.boundingBox.width,
        face.boundingBox.height
      );
    }

    // Draw object bounding boxes (red for suspicious, blue for others)
    for (const obj of result.objects) {
      ctx.strokeStyle = SUSPICIOUS_OBJECTS.includes(obj.class) ? '#ff0000' : '#0000ff';
      ctx.strokeRect(
        obj.boundingBox.x,
        obj.boundingBox.y,
        obj.boundingBox.width,
        obj.boundingBox.height
      );
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = '14px Arial';
      ctx.fillText(
        `${obj.class} (${obj.confidence.toFixed(0)}%)`,
        obj.boundingBox.x,
        obj.boundingBox.y - 5
      );
    }

    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.cocoModel) {
      // COCO-SSD doesn't have dispose, but we clear the reference
      this.cocoModel = null;
    }
    if (this.blazefaceModel) {
      this.blazefaceModel = null;
    }
    this.isInitialized = false;
    console.log('AI Proctor disposed');
  }

  /**
   * Check if models are loaded
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}

/**
 * Singleton instance
 */
let aiProctorInstance: AIProctor | null = null;

export function getAIProctor(): AIProctor {
  if (!aiProctorInstance) {
    aiProctorInstance = new AIProctor();
  }
  return aiProctorInstance;
}

export default AIProctor;
