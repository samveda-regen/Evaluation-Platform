/**
 * ProctorPanel Component
 *
 * Displays proctoring status including:
 * - Camera feed (small preview)
 * - Face detection status
 * - Audio level indicator
 * - Violation count
 * - Trust score
 */

import { useEffect, useRef, useState } from 'react';
import { ProctorStatus } from '../hooks/useProctoring';

interface ProctorPanelProps {
  status: ProctorStatus;
  cameraStream: MediaStream | null;
  setVideoElement: (video: HTMLVideoElement) => void;
  violations: number;
  maxViolations: number;
  minimized?: boolean;
  onToggleMinimize?: () => void;
  aiProctorReady?: boolean;
}

export default function ProctorPanel({
  status,
  cameraStream,
  setVideoElement,
  violations,
  maxViolations,
  minimized = false,
  onToggleMinimize,
  aiProctorReady = false,
}: ProctorPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isExpanded, setIsExpanded] = useState(!minimized);

  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
      videoRef.current.play().catch(console.error);
      setVideoElement(videoRef.current);
    }
  }, [cameraStream, setVideoElement]);

  const getFaceStatusColor = () => {
    if (!status.cameraEnabled) return 'bg-gray-400';
    if (!status.faceDetected) return 'bg-red-500';
    if (!status.lookingAtScreen) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getFaceStatusText = () => {
    if (!status.cameraEnabled) return 'Camera Off';
    if (!status.faceDetected) return 'No Face';
    if (!status.lookingAtScreen) return 'Looking Away';
    return 'OK';
  };

  const getAudioLevelColor = () => {
    if (status.audioLevel > 100) return 'bg-red-500';
    if (status.audioLevel > 50) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getTrustScoreColor = () => {
    if (status.trustScore >= 80) return 'text-green-600';
    if (status.trustScore >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  if (!isExpanded) {
    // Minimized view - just show status indicators
    return (
      <div
        className="fixed bottom-4 right-4 bg-white rounded-lg shadow-lg p-2 cursor-pointer z-40 flex items-center gap-2"
        onClick={() => {
          setIsExpanded(true);
          onToggleMinimize?.();
        }}
      >
        {/* Camera status dot */}
        <div className={`w-3 h-3 rounded-full ${getFaceStatusColor()}`} title={getFaceStatusText()} />

        {/* Mic status */}
        <div className={`w-3 h-3 rounded-full ${status.microphoneEnabled ? 'bg-green-500' : 'bg-gray-400'}`} />

        {/* Violation count */}
        <span className={`text-xs font-medium ${violations > 0 ? 'text-red-600' : 'text-gray-600'}`}>
          {violations}/{maxViolations}
        </span>

        {/* Expand icon */}
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
        </svg>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 bg-white rounded-lg shadow-lg overflow-hidden z-40 w-64">
      {/* Header */}
      <div className="bg-gray-800 text-white px-3 py-2 flex justify-between items-center">
        <span className="text-sm font-medium flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${status.isInitialized ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          Proctoring {aiProctorReady ? '(AI)' : ''} Active
        </span>
        <button
          onClick={() => {
            setIsExpanded(false);
            onToggleMinimize?.();
          }}
          className="text-gray-400 hover:text-white"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Camera Feed */}
      <div className="relative bg-gray-900 aspect-video">
        {status.cameraEnabled ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover transform -scale-x-100"
            />
            {/* Face detection overlay */}
            <div className="absolute top-2 left-2 flex items-center gap-1 bg-black bg-opacity-50 rounded px-2 py-1">
              <div className={`w-2 h-2 rounded-full ${getFaceStatusColor()}`} />
              <span className="text-xs text-white">{getFaceStatusText()}</span>
            </div>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center text-gray-500">
              <svg className="w-8 h-8 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span className="text-xs">Camera Off</span>
            </div>
          </div>
        )}
      </div>

      {/* Status Indicators */}
      <div className="p-3 space-y-2">
        {/* Devices Status */}
        <div className="flex justify-between text-xs">
          <div className="flex items-center gap-1">
            <svg className={`w-4 h-4 ${status.cameraEnabled ? 'text-green-500' : 'text-red-500'}`} fill="currentColor" viewBox="0 0 20 20">
              <path d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2H4zm12 6V9l3-1.5v5L16 11z" />
            </svg>
            <span className={status.cameraEnabled ? 'text-green-600' : 'text-red-600'}>
              {status.cameraEnabled ? 'On' : 'Off'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <svg className={`w-4 h-4 ${status.microphoneEnabled ? 'text-green-500' : 'text-red-500'}`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
            </svg>
            <span className={status.microphoneEnabled ? 'text-green-600' : 'text-red-600'}>
              {status.microphoneEnabled ? 'On' : 'Off'}
            </span>
          </div>
        </div>

        {/* Audio Level */}
        {status.microphoneEnabled && (
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500">Audio Level</span>
              <span className="text-gray-700">{Math.round(status.audioLevel)}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full transition-all ${getAudioLevelColor()}`}
                style={{ width: `${Math.min(status.audioLevel, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* AI Detection Status */}
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">AI Detection</span>
          <span className={aiProctorReady ? 'text-green-600 font-medium' : 'text-yellow-600'}>
            {aiProctorReady ? 'YOLO Active' : 'Basic'}
          </span>
        </div>

        {/* Monitor Count */}
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">Monitors</span>
          <span className={status.monitorCount > 1 ? 'text-red-600 font-medium' : 'text-gray-700'}>
            {status.monitorCount} {status.monitorCount > 1 && '(warning)'}
          </span>
        </div>

        {/* Violations */}
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">Violations</span>
          <span className={violations > 0 ? 'text-red-600 font-medium' : 'text-green-600'}>
            {violations} / {maxViolations}
          </span>
        </div>

        {/* Trust Score */}
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">Trust Score</span>
          <span className={`font-medium ${getTrustScoreColor()}`}>
            {status.trustScore.toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Warning Banner */}
      {status.violations.length > 0 && (
        <div className="bg-red-50 border-t border-red-200 px-3 py-2">
          <p className="text-xs text-red-600">
            Last violation: {status.violations[status.violations.length - 1]?.eventType}
          </p>
        </div>
      )}
    </div>
  );
}
