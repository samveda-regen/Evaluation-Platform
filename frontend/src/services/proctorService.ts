/**
 * Proctoring Service
 *
 * Handles all client-side proctoring functionality:
 * - Camera/microphone access
 * - Face detection using TensorFlow.js
 * - Eye/gaze tracking
 * - Audio analysis
 * - Screen recording
 * - External monitor detection
 * - Violation reporting
 */

import api from './api';

// Types
export interface ProctorConfig {
  requireCamera: boolean;
  requireMicrophone: boolean;
  requireScreenShare: boolean;
  faceDetectionInterval: number; // ms
  snapshotInterval: number; // ms
  analysisInterval: number; // ms
}

export interface ProctorSession {
  sessionId: string;
  attemptId: string;
  config: ProctorConfig;
}

export interface FaceDetectionResult {
  faceDetected: boolean;
  faceCount: number;
  confidence: number;
  lookingAtScreen: boolean;
  gazeDirection?: string;
}

export interface AudioAnalysisResult {
  hasVoice: boolean;
  voiceCount: number;
  audioLevel: number;
  suspiciousSound: boolean;
  confidence: number;
  backgroundNoise: boolean;
}

export interface ViolationData {
  eventType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  description: string;
  duration?: number;
  metadata?: Record<string, any>;
  snapshotData?: string;
}

export interface ViolationResponse {
  success: boolean;
  shouldTerminate: boolean;
  totalViolations?: number;
  maxViolations?: number;
}

// Initialize proctoring session
export async function initializeProctorSession(attemptId: string, deviceInfo: {
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  screenShareEnabled: boolean;
  browserInfo: { name: string; version: string; os: string };
  screenResolution: string;
  monitorCount: number;
}): Promise<ProctorSession | null> {
  try {
    const response = await api.post(`/proctoring/session/${attemptId}/init`, deviceInfo);
    return {
      sessionId: response.data.sessionId,
      attemptId,
      config: {
        requireCamera: response.data.requirements?.camera || false,
        requireMicrophone: response.data.requirements?.microphone || false,
        requireScreenShare: response.data.requirements?.screenShare || false,
        faceDetectionInterval: 1000,
        snapshotInterval: 30000,
        analysisInterval: 5000,
      },
    };
  } catch (error) {
    console.error('Failed to initialize proctor session:', error);
    return null;
  }
}

// Report a violation
export async function reportViolation(
  sessionId: string,
  violation: ViolationData
): Promise<ViolationResponse> {
  try {
    const response = await api.post(`/proctoring/session/${sessionId}/violation`, violation);
    return {
      success: true,
      shouldTerminate: response.data?.shouldTerminate || false,
      totalViolations: response.data?.totalViolations,
      maxViolations: response.data?.maxViolations,
    };
  } catch (error) {
    console.error('Failed to report violation:', error);
    return { success: false, shouldTerminate: false };
  }
}

// Submit proctoring analysis data
export async function submitAnalysis(sessionId: string, analysisData: {
  timestamp: number;
  frameData?: string;
  face?: FaceDetectionResult;
  gaze?: {
    gazeDirection: 'center' | 'left' | 'right' | 'up' | 'down' | 'unknown';
    confidence: number;
    isLookingAtScreen: boolean;
  };
  audio?: AudioAnalysisResult;
  objects?: {
    objects: Array<{
      type: string;
      confidence: number;
      boundingBox: { x: number; y: number; width: number; height: number };
    }>;
    phoneDetected: boolean;
    secondScreenDetected: boolean;
  };
  screenInfo?: {
    monitorCount: number;
    isFullscreen: boolean;
    tabVisible: boolean;
  };
}): Promise<{ violations: ViolationData[]; shouldTerminate: boolean }> {
  const response = await api.post(`/proctoring/session/${sessionId}/analysis`, analysisData);
  return {
    violations: response.data.violations || [],
    shouldTerminate: response.data.shouldTerminate || false,
  };
}

// Upload face snapshot
export async function uploadSnapshot(sessionId: string, imageData: string, purpose: string): Promise<boolean> {
  try {
    await api.post(`/proctoring/session/${sessionId}/snapshot`, {
      imageData,
      purpose,
    });
    return true;
  } catch (error) {
    console.error('Failed to upload snapshot:', error);
    return false;
  }
}

// Update monitor count
export async function updateMonitorCount(sessionId: string, monitorCount: number): Promise<boolean> {
  try {
    await api.post(`/proctoring/session/${sessionId}/monitors`, { monitorCount });
    return true;
  } catch (error) {
    console.error('Failed to update monitor count:', error);
    return false;
  }
}

// End proctoring session
export async function endProctorSession(sessionId: string): Promise<any> {
  try {
    const response = await api.post(`/proctoring/session/${sessionId}/end`);
    return response.data.summary;
  } catch (error) {
    console.error('Failed to end proctor session:', error);
    return null;
  }
}

// Upload recording chunk to backend storage
export async function uploadRecordingChunk(
  sessionId: string,
  payload: {
    recordingType: 'webcam' | 'screen' | 'audio' | 'combined';
    chunkData: string;
    mimeType: string;
    chunkIndex: number;
    startTime: string;
    endTime: string;
    duration?: number;
    fileSize?: number;
  }
): Promise<boolean> {
  try {
    await api.post(`/proctoring/session/${sessionId}/recording/upload`, payload);
    return true;
  } catch (error) {
    console.error('Failed to upload recording chunk:', error);
    return false;
  }
}

// Get browser info
export function getBrowserInfo(): { name: string; version: string; os: string } {
  const userAgent = navigator.userAgent;
  let name = 'Unknown';
  let version = '0';

  if (userAgent.includes('Firefox')) {
    name = 'Firefox';
    version = userAgent.match(/Firefox\/(\d+)/)?.[1] || '0';
  } else if (userAgent.includes('Chrome')) {
    name = 'Chrome';
    version = userAgent.match(/Chrome\/(\d+)/)?.[1] || '0';
  } else if (userAgent.includes('Safari')) {
    name = 'Safari';
    version = userAgent.match(/Version\/(\d+)/)?.[1] || '0';
  } else if (userAgent.includes('Edge')) {
    name = 'Edge';
    version = userAgent.match(/Edge\/(\d+)/)?.[1] || '0';
  }

  let os = 'Unknown';
  if (userAgent.includes('Windows')) os = 'Windows';
  else if (userAgent.includes('Mac')) os = 'macOS';
  else if (userAgent.includes('Linux')) os = 'Linux';
  else if (userAgent.includes('Android')) os = 'Android';
  else if (userAgent.includes('iOS')) os = 'iOS';

  return { name, version, os };
}

// Get screen resolution
export function getScreenResolution(): string {
  return `${window.screen.width}x${window.screen.height}`;
}

// Detect number of monitors
export async function detectMonitors(): Promise<number> {
  // Use Screen Details API if available (requires permission)
  if ('getScreenDetails' in window) {
    try {
      const screenDetails = await (window as any).getScreenDetails();
      return screenDetails.screens.length;
    } catch {
      // Permission denied or not supported
    }
  }

  // Fallback: Check if screen dimensions suggest multiple monitors
  const availWidth = window.screen.availWidth;

  // If available width is much larger than typical single monitor, suspect multiple monitors
  if (availWidth > 2560) {
    return Math.ceil(availWidth / 1920);
  }

  return 1;
}

// Request camera permission
export async function requestCameraPermission(): Promise<MediaStream | null> {
  try {
    const targetWidth = Number((import.meta as any).env?.VITE_PROCTOR_CAMERA_WIDTH || 1280);
    const targetHeight = Number((import.meta as any).env?.VITE_PROCTOR_CAMERA_HEIGHT || 720);
    const maxFrameRate = Number((import.meta as any).env?.VITE_PROCTOR_CAMERA_FPS || 30);
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: targetWidth },
        height: { ideal: targetHeight },
        frameRate: { ideal: maxFrameRate, max: maxFrameRate },
        facingMode: 'user',
      },
    });
    return stream;
  } catch (error) {
    console.error('Camera permission denied:', error);
    return null;
  }
}

// Request microphone permission
export async function requestMicrophonePermission(): Promise<MediaStream | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    return stream;
  } catch (error) {
    console.error('Microphone permission denied:', error);
    return null;
  }
}

// Request screen share
export async function requestScreenShare(): Promise<MediaStream | null> {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
    return stream;
  } catch (error) {
    console.error('Screen share denied:', error);
    return null;
  }
}

// Capture frame from video stream
export function captureFrame(
  videoElement: HTMLVideoElement,
  options: { quality?: number; maxWidth?: number } = {}
): string | null {
  try {
    const quality = options.quality ?? 0.7;
    const maxWidth = options.maxWidth ?? 640;
    const sourceWidth = videoElement.videoWidth;
    const sourceHeight = videoElement.videoHeight;
    if (!sourceWidth || !sourceHeight) return null;

    const targetWidth = Math.min(sourceWidth, maxWidth);
    const scale = targetWidth / sourceWidth;
    const targetHeight = Math.max(1, Math.floor(sourceHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(videoElement, 0, 0, targetWidth, targetHeight);
    return canvas.toDataURL('image/jpeg', quality).split(',')[1];
  } catch (error) {
    console.error('Failed to capture frame:', error);
    return null;
  }
}

// Audio analysis using Web Audio API
export class AudioAnalyzer {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private dataArray: Uint8Array | null = null;
  private voiceStreak = 0;
  private highNoiseStreak = 0;
  private readonly voiceLevelThreshold = Number((import.meta as any).env?.VITE_AUDIO_VOICE_LEVEL || 18);
  private readonly warningNoiseThreshold = Number((import.meta as any).env?.VITE_AUDIO_WARNING_LEVEL || 42);
  private readonly criticalNoiseThreshold = Number((import.meta as any).env?.VITE_AUDIO_CRITICAL_LEVEL || 58);

  async initialize(stream: MediaStream): Promise<boolean> {
    try {
      this.audioContext = new AudioContext();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.source = this.audioContext.createMediaStreamSource(stream);
      this.source.connect(this.analyser);
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      return true;
    } catch (error) {
      console.error('Failed to initialize audio analyzer:', error);
      return false;
    }
  }

  getAudioLevel(): number {
    if (!this.analyser || !this.dataArray) return 0;
    this.analyser.getByteFrequencyData(this.dataArray as Uint8Array<ArrayBuffer>);
    const sum = this.dataArray.reduce((a, b) => a + b, 0);
    return sum / this.dataArray.length;
  }

  detectVoice(): boolean {
    const level = this.getAudioLevel();
    return level > this.voiceLevelThreshold;
  }

  analyze(): AudioAnalysisResult {
    const audioLevel = this.getAudioLevel();
    const hasVoice = this.detectVoice();
    const veryLoud = audioLevel >= this.criticalNoiseThreshold;
    const warningLoud = audioLevel >= this.warningNoiseThreshold;

    this.voiceStreak = hasVoice ? this.voiceStreak + 1 : 0;
    this.highNoiseStreak = warningLoud ? this.highNoiseStreak + 1 : 0;

    let voiceCount = 0;
    if (audioLevel > this.criticalNoiseThreshold + 8) {
      voiceCount = 2;
    } else if (hasVoice) {
      voiceCount = 1;
    }

    const suspiciousSound = veryLoud || this.highNoiseStreak >= 2;
    const confidence = Math.min(1, Math.max(0.35, audioLevel / 85));

    return {
      hasVoice,
      voiceCount,
      audioLevel,
      suspiciousSound,
      confidence,
      backgroundNoise: warningLoud,
    };
  }

  destroy(): void {
    if (this.source) {
      this.source.disconnect();
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
  }
}

// Simple face detection using canvas analysis
// For production, use TensorFlow.js face-api or similar
export class SimpleFaceDetector {
  private videoElement: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  initialize(videoElement: HTMLVideoElement): void {
    this.videoElement = videoElement;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
  }

  detect(): FaceDetectionResult {
    if (!this.videoElement || !this.canvas || !this.ctx) {
      return {
        faceDetected: false,
        faceCount: 0,
        confidence: 0,
        lookingAtScreen: false,
      };
    }

    // Set canvas size
    this.canvas.width = this.videoElement.videoWidth;
    this.canvas.height = this.videoElement.videoHeight;

    // Draw current frame
    this.ctx.drawImage(this.videoElement, 0, 0);

    // Get image data for analysis
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const data = imageData.data;

    // Simple skin tone detection (very basic, for demo purposes)
    // In production, use proper ML-based face detection
    let skinPixels = 0;
    let totalPixels = data.length / 4;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Simple skin tone detection
      if (r > 95 && g > 40 && b > 20 &&
          r > g && r > b &&
          Math.abs(r - g) > 15 &&
          r - Math.min(g, b) > 15) {
        skinPixels++;
      }
    }

    const skinRatio = skinPixels / totalPixels;

    // Determine if face is likely present based on skin ratio
    // This is a very simplified heuristic
    const faceDetected = skinRatio > 0.05 && skinRatio < 0.4;

    return {
      faceDetected,
      faceCount: faceDetected ? 1 : 0,
      confidence: faceDetected ? Math.min(skinRatio * 300, 100) : 0,
      lookingAtScreen: faceDetected, // Simplified - would need gaze tracking for accuracy
    };
  }
}

// Media recorder for session recording
export class ProctorRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  async start(videoStream?: MediaStream, audioStream?: MediaStream): Promise<boolean> {
    try {
      const tracks: MediaStreamTrack[] = [];

      if (videoStream) {
        tracks.push(...videoStream.getVideoTracks());
      }
      if (audioStream) {
        tracks.push(...audioStream.getAudioTracks());
      }

      if (tracks.length === 0) return false;

      this.stream = new MediaStream(tracks);
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: 'video/webm;codecs=vp8,opus',
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };

      this.mediaRecorder.start(10000); // Capture in 10-second chunks
      return true;
    } catch (error) {
      console.error('Failed to start recording:', error);
      return false;
    }
  }

  stop(): Blob | null {
    if (!this.mediaRecorder) return null;

    return new Promise((resolve) => {
      this.mediaRecorder!.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'video/webm' });
        this.chunks = [];
        resolve(blob);
      };
      this.mediaRecorder!.stop();
    }) as unknown as Blob;
  }

  getChunks(): Blob[] {
    return [...this.chunks];
  }
}

export default {
  initializeProctorSession,
  reportViolation,
  submitAnalysis,
  uploadSnapshot,
  updateMonitorCount,
  endProctorSession,
  uploadRecordingChunk,
  getBrowserInfo,
  getScreenResolution,
  detectMonitors,
  requestCameraPermission,
  requestMicrophonePermission,
  requestScreenShare,
  captureFrame,
  AudioAnalyzer,
  SimpleFaceDetector,
  ProctorRecorder,
};
