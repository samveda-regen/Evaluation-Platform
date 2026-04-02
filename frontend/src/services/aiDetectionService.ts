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

  /**
   * Initialize TensorFlow.js and load models.
   * On low-end devices (< 4 CPU cores or < 4 GB RAM) COCO-SSD is skipped —
   * only BlazeFace is loaded. Phone/object detection falls back to the Python service.
   * Both model loads are wrapped with an 8-second timeout to avoid hanging indefinitely.
   */
  async initialize(): Promise<boolean> {
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
      return this.isInitialized;
    } catch (error) {
      console.error('Failed to initialize AI Proctor:', error);
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

      // Estimate gaze direction based on face position
      if (landmarks) {
        const faceCenter = {
          x: (topLeft[0] + bottomRight[0]) / 2,
          y: (topLeft[1] + bottomRight[1]) / 2,
        };
        const videoCenter = {
          x: video.videoWidth / 2,
          y: video.videoHeight / 2,
        };

        const xOffset = (faceCenter.x - videoCenter.x) / video.videoWidth;
        const yOffset = (faceCenter.y - videoCenter.y) / video.videoHeight;

        // Determine gaze direction
        if (Math.abs(xOffset) < 0.15 && Math.abs(yOffset) < 0.15) {
          faceResult.gazeDirection = 'center';
          faceResult.isLookingAtScreen = true;
        } else if (xOffset < -0.2) {
          faceResult.gazeDirection = 'left';
          faceResult.isLookingAtScreen = false;
        } else if (xOffset > 0.2) {
          faceResult.gazeDirection = 'right';
          faceResult.isLookingAtScreen = false;
        } else if (yOffset < -0.2) {
          faceResult.gazeDirection = 'up';
          faceResult.isLookingAtScreen = false;
        } else if (yOffset > 0.2) {
          faceResult.gazeDirection = 'down';
          faceResult.isLookingAtScreen = false;
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
