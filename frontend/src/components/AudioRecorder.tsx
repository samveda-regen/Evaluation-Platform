import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Square, RotateCcw, Loader2 } from 'lucide-react';
import { getCachedStreams } from '../services/devicePermissionService';

interface AudioRecorderProps {
  maxDurationSec: number;
  onSubmitRecording: (base64: string, mimeType: string) => Promise<void>;
  disabled?: boolean;
  alreadyRecorded?: boolean;
  existingAudioUrl?: string | null;
}

type Status = 'idle' | 'recording' | 'recorded' | 'saving' | 'saved';

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

function pickSupportedMimeType(): string {
  for (const type of MIME_CANDIDATES) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return '';
}

export default function AudioRecorder({ maxDurationSec, onSubmitRecording, disabled, alreadyRecorded, existingAudioUrl }: AudioRecorderProps) {
  const [status, setStatus] = useState<Status>(alreadyRecorded ? 'saved' : 'idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blobRef = useRef<Blob | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const startRecording = async () => {
    setError('');
    try {
      // Reuse the mic already granted/cached on the pre-exam device-check page when available,
      // instead of prompting again mid-exam. Clone the tracks rather than reusing them directly —
      // stopStream() below calls .stop() on this component's own tracks after every recording,
      // and MediaStreamTrack.stop() affects the underlying track everywhere it's referenced, which
      // would otherwise kill the cached stream for subsequent Speaking questions.
      const cachedMic = getCachedStreams().microphoneStream;
      const stream = cachedMic
        ? new MediaStream(cachedMic.getAudioTracks().map(t => t.clone()))
        : await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickSupportedMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        blobRef.current = blob;
        setPreviewUrl(URL.createObjectURL(blob));
        setStatus('recorded');
        stopStream();
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setStatus('recording');
      setElapsedSec(0);

      timerRef.current = setInterval(() => {
        setElapsedSec(prev => {
          const next = prev + 1;
          if (next >= maxDurationSec) {
            stopRecording();
          }
          return next;
        });
      }, 1000);
    } catch {
      setError('Microphone access is required to answer this question. Please allow microphone permission and try again.');
    }
  };

  const stopRecording = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const reRecord = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    blobRef.current = null;
    setStatus('idle');
    setElapsedSec(0);
    setError('');
  };

  const submit = async () => {
    if (!blobRef.current) return;
    setStatus('saving');
    setError('');
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blobRef.current!);
      });
      await onSubmitRecording(base64, blobRef.current.type || 'audio/webm');
      setStatus('saved');
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save recording. Please try again.');
      setStatus('recorded');
    }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="rounded-xl border p-5" style={{ borderColor: 'var(--admin-border)', backgroundColor: '#F9FAFB' }}>
      {error && (
        <p className="text-xs mb-3 font-medium" style={{ color: '#DC2626' }}>{error}</p>
      )}

      {status === 'idle' && (
        <div className="flex flex-col items-center gap-3 py-4">
          <button
            type="button" onClick={startRecording} disabled={disabled}
            className="w-14 h-14 rounded-full flex items-center justify-center text-white transition-opacity disabled:opacity-40"
            style={{ backgroundColor: '#DC2626' }}
          >
            <Mic size={22} stroke="white" />
          </button>
          <p className="text-xs text-gray-500">Tap to start recording · up to {fmt(maxDurationSec)}</p>
        </div>
      )}

      {status === 'recording' && (
        <div className="flex flex-col items-center gap-3 py-4">
          <button
            type="button" onClick={stopRecording}
            className="w-14 h-14 rounded-full flex items-center justify-center text-white animate-pulse"
            style={{ backgroundColor: '#DC2626' }}
          >
            <Square size={20} fill="white" stroke="white" />
          </button>
          <p className="text-sm font-semibold" style={{ color: '#DC2626' }}>Recording… {fmt(elapsedSec)} / {fmt(maxDurationSec)}</p>
        </div>
      )}

      {(status === 'recorded' || status === 'saving') && previewUrl && (
        <div className="flex flex-col gap-3 py-2">
          <audio src={previewUrl} controls className="w-full" preload="metadata" />
          <div className="flex items-center gap-3">
            <button
              type="button" onClick={reRecord} disabled={status === 'saving'}
              className="flex items-center gap-1.5 text-sm font-medium disabled:opacity-40"
              style={{ color: 'var(--admin-text-muted)' }}
            >
              <RotateCcw size={14} /> Re-record
            </button>
            <button
              type="button" onClick={submit} disabled={status === 'saving'}
              className="btn btn-primary ml-auto"
              style={{ width: 'auto' }}
            >
              {status === 'saving' ? (<><Loader2 size={14} className="animate-spin" /> Transcribing…</>) : 'Submit recording'}
            </button>
          </div>
        </div>
      )}

      {status === 'saved' && (
        <div className="flex items-center justify-between py-1">
          <p className="text-sm font-semibold" style={{ color: 'var(--admin-accent-hover)' }}>✓ Recording saved</p>
          <button type="button" onClick={reRecord} disabled={disabled} className="flex items-center gap-1.5 text-sm font-medium disabled:opacity-40" style={{ color: 'var(--admin-text-muted)' }}>
            <RotateCcw size={14} /> Re-record
          </button>
        </div>
      )}
      {status === 'saved' && (previewUrl || existingAudioUrl) && (
        <audio src={previewUrl || existingAudioUrl || undefined} controls className="w-full mt-3" preload="metadata" />
      )}
    </div>
  );
}
