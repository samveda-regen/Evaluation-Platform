import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Video, Square, Trash2, Download, Circle } from 'lucide-react';
import { adminApi } from '../../services/api';
import type { DataCollectionRecording, CandidateDataCollectionRecording } from '../../services/api';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function DataCollection() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState('');

  const [items, setItems] = useState<DataCollectionRecording[]>([]);
  const [loading, setLoading] = useState(true);

  const [candidateItems, setCandidateItems] = useState<CandidateDataCollectionRecording[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(true);

  const loadRecordings = useCallback(async () => {
    try {
      const { data } = await adminApi.getDataCollectionRecordings();
      setItems(data.items || []);
    } catch {
      toast.error('Could not load saved recordings');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCandidateRecordings = useCallback(async () => {
    try {
      const { data } = await adminApi.getCandidateDataCollectionRecordings();
      setCandidateItems(data.items || []);
    } catch {
      toast.error('Could not load candidate session recordings');
    } finally {
      setCandidateLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecordings();
    loadCandidateRecordings();
  }, [loadRecordings, loadCandidateRecordings]);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch {
      toast.error('Could not access camera/microphone — please allow permissions');
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startRecording = useCallback(() => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const recorder = new MediaRecorder(streamRef.current, { mimeType: 'video/webm;codecs=vp8,opus' });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  }, []);

  const stopRecording = useCallback(() => {
    return new Promise<Blob | null>((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder) {
        resolve(null);
        return;
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        resolve(blob);
      };
      recorder.stop();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setRecording(false);
    });
  }, []);

  const handleStop = useCallback(async () => {
    const blob = await stopRecording();
    if (!blob || blob.size === 0) {
      toast.error('Recording was empty — nothing to save');
      return;
    }

    setSaving(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      await adminApi.uploadDataCollectionRecording({
        videoData: base64,
        mimeType: 'video/webm',
        label: label.trim() || undefined,
      });

      toast.success('Recording saved to DATA COLLECTION');
      setLabel('');
      await loadRecordings();
    } catch {
      toast.error('Failed to save recording');
    } finally {
      setSaving(false);
    }
  }, [label, loadRecordings, stopRecording]);

  const handleDelete = useCallback(async (fileId: string) => {
    if (!window.confirm('Delete this recording? This cannot be undone.')) return;
    try {
      await adminApi.deleteDataCollectionRecording(fileId);
      setItems((prev) => prev.filter((item) => item.fileId !== fileId));
      toast.success('Recording deleted');
    } catch {
      toast.error('Failed to delete recording');
    }
  }, []);

  return (
    <div style={{ padding: 0, backgroundColor: '#F9FAFB', minHeight: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '24px' }}>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--admin-text)', margin: 0 }}>Data Collection</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--admin-text-muted)' }}>
            Standalone webcam recordings, stored separately under "DATA COLLECTION".
          </p>
        </div>
      </div>

      <div className="grid gap-6" style={{ gridTemplateColumns: 'minmax(0, 420px) 1fr' }}>
        {/* Recorder panel */}
        <div style={{ backgroundColor: 'white', border: '1px solid var(--admin-border)', borderRadius: '12px', padding: '16px' }}>
          <div className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            {!cameraReady && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-400">
                <Video size={28} />
                <span className="text-xs">Camera not started</span>
              </div>
            )}
            {recording && (
              <span
                className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full text-white text-xs font-semibold"
                style={{ backgroundColor: 'rgba(220,38,38,0.9)' }}
              >
                <Circle size={8} fill="white" /> REC {formatDuration(elapsed)}
              </span>
            )}
          </div>

          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional) — e.g. candidate name, session note"
            disabled={recording}
            className="mt-3 w-full text-sm px-3 py-2 rounded-lg border outline-none"
            style={{ borderColor: 'var(--admin-border)' }}
          />

          <div className="flex gap-2 mt-3">
            {!cameraReady ? (
              <button onClick={startCamera} className="btn btn-secondary flex-1">
                Enable camera
              </button>
            ) : !recording ? (
              <>
                <button onClick={startRecording} className="btn btn-primary flex-1 flex items-center justify-center gap-2">
                  <Video size={16} /> Start recording
                </button>
                <button onClick={stopCamera} className="btn btn-secondary">
                  Turn off camera
                </button>
              </>
            ) : (
              <button
                onClick={handleStop}
                disabled={saving}
                className="btn btn-primary flex-1 flex items-center justify-center gap-2"
                style={{ backgroundColor: '#DC2626', borderColor: '#DC2626' }}
              >
                <Square size={16} /> {saving ? 'Saving…' : 'Stop & save'}
              </button>
            )}
          </div>
        </div>

        {/* Saved recordings */}
        <div style={{ backgroundColor: 'white', border: '1px solid var(--admin-border)', borderRadius: '12px', padding: '16px' }}>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--admin-text)' }}>
            Saved recordings {items.length > 0 && `(${items.length})`}
          </h2>

          {loading ? (
            <p className="text-sm" style={{ color: 'var(--admin-text-subtle)' }}>Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--admin-text-subtle)' }}>No recordings saved yet.</p>
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
              {items.map((item) => (
                <div key={item.fileId} style={{ border: '1px solid var(--admin-border)', borderRadius: '10px', overflow: 'hidden' }}>
                  <video src={item.url} controls className="w-full bg-black" style={{ aspectRatio: '16/9' }} />
                  <div className="p-2">
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--admin-text)' }}>
                      {item.label || item.originalName}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--admin-text-subtle)' }}>
                      {formatBytes(item.fileSize)} · {new Date(item.createdAt).toLocaleString()}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <a
                        href={`${item.url}/download`}
                        className="flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded-md"
                        style={{ border: '1px solid var(--admin-border)', color: 'var(--admin-text-muted)' }}
                      >
                        <Download size={12} /> Download
                      </a>
                      <button
                        onClick={() => handleDelete(item.fileId)}
                        className="flex items-center justify-center px-2 rounded-md"
                        style={{ border: '1px solid var(--admin-border)', color: '#DC2626' }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Candidate session recordings (auto-captured start-test -> submit-test) */}
      <div style={{ backgroundColor: 'white', border: '1px solid var(--admin-border)', borderRadius: '12px', padding: '16px', marginTop: '24px' }}>
        <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--admin-text)' }}>
          Candidate session recordings {candidateItems.length > 0 && `(${candidateItems.length})`}
        </h2>
        <p className="text-xs mb-3" style={{ color: 'var(--admin-text-subtle)' }}>
          Auto-captured webcam recordings, running from "Start Test" to "Submit Test" — separate from proctoring.
        </p>

        {candidateLoading ? (
          <p className="text-sm" style={{ color: 'var(--admin-text-subtle)' }}>Loading…</p>
        ) : candidateItems.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--admin-text-subtle)' }}>No candidate session recordings yet.</p>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {candidateItems.map((item) => (
              <div key={item.fileId} style={{ border: '1px solid var(--admin-border)', borderRadius: '10px', overflow: 'hidden' }}>
                <video src={item.url} controls className="w-full bg-black" style={{ aspectRatio: '16/9' }} />
                <div className="p-2">
                  <p className="text-xs font-medium truncate" style={{ color: 'var(--admin-text)' }}>
                    {item.candidateName}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--admin-text-subtle)' }}>
                    {formatBytes(item.fileSize)} · {new Date(item.createdAt).toLocaleString()}
                  </p>
                  <a
                    href={`${item.url}/download`}
                    className="mt-2 flex items-center justify-center gap-1 text-xs py-1.5 rounded-md"
                    style={{ border: '1px solid var(--admin-border)', color: 'var(--admin-text-muted)' }}
                  >
                    <Download size={12} /> Download
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
