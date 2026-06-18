import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Camera, RotateCcw, Check } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface WebcamCaptureProps {
  onCapture: (imageData: string) => void;
  onClose:   () => void;
}

export default function WebcamCapture({ onCapture, onClose }: WebcamCaptureProps) {
  const [stream,    setStream]    = useState<MediaStream | null>(null);
  const [captured,  setCaptured]  = useState<string | null>(null);
  const [starting,  setStarting]  = useState(true);

  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const startCamera = useCallback(async () => {
    setStarting(true);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play();
      }
    } catch {
      toast.error('Could not access camera — please allow camera permissions');
      onClose();
    } finally {
      setStarting(false);
    }
  }, [onClose]);

  const stopCamera = useCallback(() => {
    stream?.getTracks().forEach(t => t.stop());
    setStream(null);
  }, [stream]);

  useEffect(() => {
    startCamera();
    return () => {
      // cleanup on unmount — grab current stream from ref to avoid stale closure
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stop camera when stream changes (cleanup)
  useEffect(() => {
    return () => { stream?.getTracks().forEach(t => t.stop()); };
  }, [stream]);

  const capture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0); // no mirror — document should appear as-is
    const b64 = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
    setCaptured(b64);
    stopCamera();
  }, [stopCamera]);

  const retake = useCallback(() => {
    setCaptured(null);
    startCamera();
  }, [startCamera]);

  const confirm = useCallback(() => {
    if (captured) onCapture(captured);
  }, [captured, onCapture]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold text-gray-800">Capture ID Document</h3>
          <button
            onClick={() => { stopCamera(); onClose(); }}
            className="p-1 rounded-full hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Camera / preview */}
        <div className="relative bg-gray-900 aspect-video">
          {!captured ? (
            <>
              {starting && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white" />
                </div>
              )}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              {/* ID card frame guide */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div
                  className="border-2 border-white rounded-lg opacity-60"
                  style={{ width: '70%', aspectRatio: '1.586' }}
                />
              </div>
              <p className="absolute bottom-3 left-0 right-0 text-center text-white text-xs opacity-70">
                Align your ID card within the frame
              </p>
            </>
          ) : (
            <img
              src={`data:image/jpeg;base64,${captured}`}
              alt="Captured document"
              className="w-full h-full object-cover"
            />
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />

        {/* Actions */}
        <div className="flex gap-3 p-4">
          {!captured ? (
            <>
              <button
                onClick={() => { stopCamera(); onClose(); }}
                className="btn btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={capture}
                disabled={starting || !stream}
                className="btn btn-primary flex-1 flex items-center justify-center gap-2"
              >
                <Camera className="w-4 h-4" />
                Capture
              </button>
            </>
          ) : (
            <>
              <button
                onClick={retake}
                className="btn btn-secondary flex-1 flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Retake
              </button>
              <button
                onClick={confirm}
                className="btn btn-primary flex-1 flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                Use This Photo
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
