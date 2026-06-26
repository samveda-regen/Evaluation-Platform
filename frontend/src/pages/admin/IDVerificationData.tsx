import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { CreditCard, Camera, CheckCircle2, XCircle, Trash2 } from 'lucide-react';

/* -- Types -- */
interface VerificationStats {
  verified: number;
  pending: number;
  mismatch: number;
  avgConfidence: number;
}

interface VerificationCandidate {
  candidateId: string;
  candidateName: string;
  documentType: string;
  status: 'verified' | 'pending' | 'mismatch';
}

interface VerificationDetail extends VerificationCandidate {
  idDocumentUrl?: string;
  webcamCaptureUrl?: string;
  confidence?: number;
  checks?: {
    nameMatch?: boolean;
    photoMatch?: boolean;
    documentValid?: boolean;
    notExpired?: boolean;
  };
}

/* -- Avatar helpers -- */
const AVATAR_BG: string[] = [
  '#374151','#1E40AF','#065F46','#92400E','#7C3AED','#B91C1C','#0E7490','#4D7C0F',
];
function avatarBg(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return AVATAR_BG[sum % AVATAR_BG.length];
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).map(w => w.replace(/[^a-zA-Z]/g, '')).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] ?? name.replace(/[^a-zA-Z]/g,'')[0] ?? '?').toUpperCase();
}

/* -- Status config -- */
type StatusKey = 'verified' | 'pending' | 'mismatch';
const STATUS_CFG: Record<StatusKey, { label: string; dot: string; color: string }> = {
  verified: { label: 'Verified',       dot: '#10B981', color: '#059669' },
  pending:  { label: 'Pending review', dot: 'var(--admin-accent)', color: 'var(--admin-accent-hover)' },
  mismatch: { label: 'Mismatch',       dot: '#EF4444', color: '#DC2626' },
};

/* -- Image placeholder -- */
function ImgPlaceholder({ icon }: { icon: 'document' | 'camera' }) {
  return (
    <div style={{
      flex: 1, backgroundColor: 'var(--admin-border)', borderRadius: '10px', minHeight: '140px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px',
    }}>
      {icon === 'document' ? (
        <CreditCard width={32} height={32} style={{ color: '#CBD5E1' }} />
      ) : (
        <Camera width={32} height={32} style={{ color: '#CBD5E1' }} />
      )}
    </div>
  );
}

/* -- Deleted image notice -- */
function DeletedImg() {
  return (
    <div style={{
      backgroundColor: '#F9FAFB', borderRadius: '10px', minHeight: '140px', border: '1.5px dashed var(--admin-border)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '12px',
    }}>
      <Trash2 width={22} height={22} style={{ color: '#D1D5DB' }} />
      <span style={{ fontSize: '11px', color: '#9CA3AF', textAlign: 'center', lineHeight: 1.4 }}>
        Deleted after<br />verification
      </span>
    </div>
  );
}

/* -- Safe image with fallback to DeletedImg on 404 -- */
function VerifImg({ src, alt, icon }: { src?: string; alt: string; icon: 'document' | 'camera' }) {
  const [failed, setFailed] = useState(false);
  if (!src)   return <ImgPlaceholder icon={icon} />;
  if (failed) return <DeletedImg />;
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      style={{ width: '100%', borderRadius: '10px', objectFit: 'cover', minHeight: '140px', display: 'block' }}
    />
  );
}

/* -- Check row -- */
function CheckRow({ label, pass }: { label: string; pass: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      {pass ? (
        <CheckCircle2 width={14} height={14} style={{ color: '#10B981', flexShrink: 0 }} />
      ) : (
        <XCircle width={14} height={14} style={{ color: '#EF4444', flexShrink: 0 }} />
      )}
      <span style={{ fontSize: '12px', color: '#374151' }}>{label}</span>
    </div>
  );
}

/* -- Reject reason modal -- */
function RejectModal({ onConfirm, onCancel }: { onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ backgroundColor: 'white', borderRadius: '14px', padding: '28px', width: '400px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>Reject Verification</h3>
        <p style={{ fontSize: '13px', color: '#6B7280', margin: '0 0 16px' }}>Please provide a reason for rejection.</p>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Enter rejection reason..."
          rows={3}
          style={{
            width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1.5px solid var(--admin-border)',
            fontSize: '13px', color: '#374151', outline: 'none', boxSizing: 'border-box', backgroundColor: 'white',
          }}
        />
        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          <button onClick={onCancel}
            style={{ flex: 1, padding: '9px', borderRadius: '8px', border: '1.5px solid var(--admin-border)', backgroundColor: 'white', fontSize: '13px', fontWeight: 500, color: '#374151', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={() => onConfirm(reason || 'Rejected by admin')} disabled={!reason.trim()}
            style={{ flex: 1, padding: '9px', borderRadius: '8px', border: 'none', backgroundColor: reason.trim() ? '#EF4444' : '#FCA5A5', fontSize: '13px', fontWeight: 600, color: 'white', cursor: reason.trim() ? 'pointer' : 'not-allowed' }}>
            Confirm Reject
          </button>
        </div>
      </div>
    </div>
  );
}

/* -- Confirm modal -- */
function ConfirmModal({ title, body, confirmLabel, confirmColor, onConfirm, onCancel }: {
  title: string; body: string; confirmLabel: string; confirmColor: string;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ backgroundColor: 'white', borderRadius: '14px', padding: '28px', width: '380px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>{title}</h3>
        <p style={{ fontSize: '13px', color: '#6B7280', margin: '0 0 20px' }}>{body}</p>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onCancel}
            style={{ flex: 1, padding: '9px', borderRadius: '8px', border: '1.5px solid var(--admin-border)', backgroundColor: 'white', fontSize: '13px', fontWeight: 500, color: '#374151', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={onConfirm}
            style={{ flex: 1, padding: '9px', borderRadius: '8px', border: 'none', backgroundColor: confirmColor, fontSize: '13px', fontWeight: 600, color: 'white', cursor: 'pointer' }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function IDVerificationData() {
  const navigate = useNavigate();

  const [stats,          setStats]          = useState<VerificationStats | null>(null);
  const [queue,          setQueue]          = useState<VerificationCandidate[]>([]);
  const [selected,       setSelected]       = useState<VerificationDetail | null>(null);
  const [loadingQueue,   setLoadingQueue]   = useState(true);
  const [loadingDetail,  setLoadingDetail]  = useState(false);
  const [approving,      setApproving]      = useState(false);
  const [rejecting,      setRejecting]      = useState(false);
  const [deletingImgs,   setDeletingImgs]   = useState(false);
  const [deletingRecord, setDeletingRecord] = useState(false);
  const [showReject,     setShowReject]     = useState(false);
  const [showDeleteImgsConfirm,   setShowDeleteImgsConfirm]   = useState(false);
  const [showDeleteRecordConfirm, setShowDeleteRecordConfirm] = useState(false);
  const [deleteTarget,   setDeleteTarget]   = useState<{ candidateId: string; name: string } | null>(null);
  const [queueFilter,    setQueueFilter]    = useState<'pending' | 'all' | 'verified' | 'rejected'>('pending');

  useEffect(() => { void loadStats(); }, []);
  useEffect(() => { void loadQueue(queueFilter); }, [queueFilter]);

  const loadStats = async () => {
    try {
      const { data } = await adminApi.getVerificationStats();
      const s = data.stats ?? data;
      setStats({
        verified:      s.verified      ?? s.total_verified      ?? 0,
        pending:       s.pending       ?? s.total_pending        ?? 0,
        mismatch:     (s.mismatch      ?? s.total_mismatch       ?? 0) + (s.rejected ?? 0),
        avgConfidence: s.avgConfidence ?? s.avg_confidence       ?? 0,
      });
    } catch { /* silent */ }
  };

  const loadQueue = async (filter: 'pending' | 'all' | 'verified' | 'rejected' = 'pending') => {
    setLoadingQueue(true);
    try {
      const params: Record<string, unknown> = { limit: 50 };
      if (filter !== 'all') params.status = filter === 'rejected' ? 'rejected' : filter;
      const { data } = await adminApi.getVerificationList(params);
      const items: VerificationCandidate[] = (data.verifications ?? data.items ?? data.list ?? []).map(
        (v: Record<string, unknown>) => {
          const nested = v.candidate as Record<string, unknown> | undefined;
          return {
            candidateId:   String(v.candidateId   ?? v.candidate_id   ?? v.id ?? ''),
            candidateName: String(nested?.name ?? v.candidateName ?? v.candidate_name ?? v.name ?? 'Unknown'),
            documentType:  String(v.idDocumentType ?? v.documentType ?? v.document_type ?? v.docType ?? 'ID'),
            status:        normaliseStatus(String(v.verificationStatus ?? v.status ?? 'pending')),
          };
        }
      );
      setQueue(items);
      const first = items.find(i => i.status === 'pending' || i.status === 'mismatch') ?? items[0];
      if (first) void loadDetail(first.candidateId);
    } catch { toast.error('Failed to load verification queue'); }
    finally { setLoadingQueue(false); }
  };

  const normaliseStatus = (s: string): StatusKey => {
    if (s === 'verified' || s === 'approved') return 'verified';
    if (s === 'mismatch' || s === 'rejected') return 'mismatch';
    return 'pending';
  };

  const loadDetail = async (candidateId: string) => {
    setLoadingDetail(true);
    try {
      const { data } = await adminApi.getVerificationDetails(candidateId);
      const d = (data.verification ?? data.identity ?? data) as Record<string, unknown>;
      const nested = d.candidate as Record<string, unknown> | undefined;
      const faceScore = typeof d.faceMatchScore === 'number' ? d.faceMatchScore : undefined;
      setSelected({
        candidateId,
        candidateName: String(nested?.name ?? d.candidateName ?? d.candidate_name ?? d.name ?? 'Unknown'),
        documentType:  String(d.idDocumentType ?? d.documentType ?? d.document_type ?? d.docType ?? 'ID'),
        status:        normaliseStatus(String(d.verificationStatus ?? d.status ?? 'pending')),
        idDocumentUrl:    (d.idDocumentUrl    ?? d.id_document_url    ?? d.documentUrl)   as string | undefined,
        webcamCaptureUrl: (d.faceReferenceUrl ?? d.webcamCaptureUrl ?? d.webcam_capture_url ?? d.selfieUrl) as string | undefined,
        confidence:    faceScore ?? (typeof d.confidence === 'number' ? d.confidence : typeof d.score === 'number' ? d.score : undefined),
        checks: {
          nameMatch:     true,
          photoMatch:    faceScore !== undefined ? faceScore >= 65 : false,
          documentValid: (d.documentAuthScore as number | undefined) !== undefined ? (d.documentAuthScore as number) >= 30 : true,
          notExpired:    d.verificationStatus !== 'expired',
        },
      });
    } catch { toast.error('Failed to load candidate details'); }
    finally { setLoadingDetail(false); }
  };

  const handleApprove = async () => {
    if (!selected) return;
    setApproving(true);
    try {
      await adminApi.approveVerification(selected.candidateId);
      toast.success(`${selected.candidateName} verified successfully`);
      setSelected(s => s ? { ...s, status: 'verified', idDocumentUrl: undefined, webcamCaptureUrl: undefined } : s);
      void loadStats();
      void loadQueue(queueFilter);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error ?? 'Failed to approve');
    } finally { setApproving(false); }
  };

  const handleReject = async (reason: string) => {
    if (!selected) return;
    setShowReject(false);
    setRejecting(true);
    try {
      await adminApi.rejectVerification(selected.candidateId, reason);
      toast.success(`${selected.candidateName} rejected`);
      setSelected(s => s ? { ...s, status: 'mismatch', idDocumentUrl: undefined, webcamCaptureUrl: undefined } : s);
      void loadStats();
      void loadQueue(queueFilter);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error ?? 'Failed to reject');
    } finally { setRejecting(false); }
  };

  const handleDeleteImages = async () => {
    if (!selected) return;
    setShowDeleteImgsConfirm(false);
    setDeletingImgs(true);
    try {
      await adminApi.deleteVerificationImages(selected.candidateId);
      toast.success('Images deleted');
      setSelected(s => s ? { ...s, idDocumentUrl: undefined, webcamCaptureUrl: undefined } : s);
    } catch { toast.error('Failed to delete images'); }
    finally { setDeletingImgs(false); }
  };

  const handleDeleteRecord = async () => {
    const target = deleteTarget ?? (selected ? { candidateId: selected.candidateId, name: selected.candidateName } : null);
    if (!target) return;
    setShowDeleteRecordConfirm(false);
    setDeleteTarget(null);
    setDeletingRecord(true);
    try {
      await adminApi.deleteVerificationRecord(target.candidateId);
      toast.success(`Verification record for ${target.name} deleted`);
      if (selected?.candidateId === target.candidateId) setSelected(null);
      void loadStats();
      void loadQueue(queueFilter);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error ?? 'Failed to delete record');
    } finally { setDeletingRecord(false); }
  };

  const conf      = selected?.confidence ?? 0;
  const hasConf   = selected?.confidence !== undefined && selected.confidence !== null;
  const confColor = conf >= 80 ? '#10B981' : conf >= 60 ? 'var(--admin-accent)' : '#EF4444';
  const selStatus = selected ? STATUS_CFG[selected.status] : null;

  return (
    <div style={{ backgroundColor: '#F9FAFB', minHeight: '100%' }}>

      {/* -- HEADER -- */}
      <div style={{ marginBottom: '24px' }}>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--admin-text)', margin: 0 }}>ID Verification</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--admin-text-muted)' }}>Photo ID checks matched against webcam capture before test start.</p>
      </div>

      {/* -- KPI CARDS -- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '22px' }}>
        {[
          { value: stats?.verified      ?? '-', label: 'Verified',        bar: 'var(--admin-accent)' },
          { value: stats?.pending       ?? '-', label: 'Pending',         bar: 'var(--admin-accent)' },
          { value: stats?.mismatch      ?? '-', label: 'Mismatch',        bar: '#EF4444' },
          { value: stats ? `${Math.round(stats.avgConfidence)}%` : '-', label: 'Avg confidence', bar: 'var(--admin-accent)' },
        ].map(kpi => (
          <div key={kpi.label} style={{
            backgroundColor: 'white', borderRadius: '14px', padding: '20px 22px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'flex-start', gap: '14px',
          }}>
            <div style={{ width: '4px', height: '44px', borderRadius: '4px', backgroundColor: kpi.bar, flexShrink: 0 }} />
            <div>
              <p style={{ fontSize: '26px', fontWeight: 700, color: '#111827', margin: 0, lineHeight: 1 }}>{String(kpi.value)}</p>
              <p style={{ fontSize: '12px', color: '#6B7280', margin: '4px 0 0' }}>{kpi.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* -- 2-COLUMN LAYOUT -- */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: '16px', alignItems: 'start' }}>

        {/* -- LEFT: Verification queue -- */}
        <div style={{ backgroundColor: 'white', borderRadius: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#111827', margin: 0 }}>Verification queue</h2>
            {/* Filter tabs */}
            <div style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--admin-border)', borderRadius: '8px', padding: '3px' }}>
              {(['pending', 'all', 'verified', 'rejected'] as const).map(f => (
                <button key={f} onClick={() => setQueueFilter(f)}
                  style={{
                    padding: '4px 10px', borderRadius: '6px', border: 'none', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                    backgroundColor: queueFilter === f ? 'white' : 'transparent',
                    color: queueFilter === f ? '#111827' : '#6B7280',
                    boxShadow: queueFilter === f ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    textTransform: 'capitalize',
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {loadingQueue ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
              <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--admin-accent)' }} />
            </div>
          ) : queue.length === 0 ? (
            <p style={{ color: '#9CA3AF', fontSize: '14px', textAlign: 'center', padding: '40px 0' }}>No verifications found</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {queue.map(c => {
                const isActive = selected?.candidateId === c.candidateId;
                const cfg = STATUS_CFG[c.status];
                const bg = avatarBg(c.candidateName);
                return (
                  <button key={c.candidateId} onClick={() => loadDetail(c.candidateId)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', borderRadius: '12px',
                      border: 'none', backgroundColor: isActive ? 'var(--admin-accent-soft)' : 'white',
                      cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'background-color 0.12s',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(31, 53, 86, 0.08)'; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'white'; }}>

                    <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: 'white' }}>{initials(c.candidateName)}</span>
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '14px', fontWeight: 600, color: '#111827', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.candidateName}</p>
                      <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '2px 0 0' }}>{c.documentType}</p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <div style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: cfg.dot }} />
                        <span style={{ fontSize: '12px', fontWeight: 500, color: cfg.color }}>{cfg.label}</span>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); setDeleteTarget({ candidateId: c.candidateId, name: c.candidateName }); setShowDeleteRecordConfirm(true); }}
                        title="Delete verification record"
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: '26px', height: '26px', borderRadius: '6px',
                          border: '1px solid #FCA5A5', backgroundColor: '#FEF2F2',
                          color: '#DC2626', cursor: 'pointer', flexShrink: 0,
                        }}
                      >
                        <Trash2 width={12} height={12} />
                      </button>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* -- RIGHT: Detail panel -- */}
        <div style={{ backgroundColor: 'white', borderRadius: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', padding: '24px' }}>
          {loadingDetail ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
              <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--admin-accent)' }} />
            </div>
          ) : !selected ? (
            <p style={{ color: '#9CA3AF', fontSize: '14px', textAlign: 'center', padding: '80px 0' }}>Select a candidate</p>
          ) : (
            <>
              {/* Candidate header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '44px', height: '44px', borderRadius: '50%', backgroundColor: avatarBg(selected.candidateName), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: 'white' }}>{initials(selected.candidateName)}</span>
                  </div>
                  <div>
                    <p style={{ fontSize: '15px', fontWeight: 700, color: '#111827', margin: 0 }}>{selected.candidateName}</p>
                    <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '2px 0 0' }}>{selected.documentType}</p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {selStatus && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px', borderRadius: '20px', backgroundColor: selected.status === 'verified' ? '#ECFDF5' : selected.status === 'mismatch' ? '#FEF2F2' : 'var(--admin-accent-soft)' }}>
                      <div style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: selStatus.dot }} />
                      <span style={{ fontSize: '12px', fontWeight: 600, color: selStatus.color }}>{selStatus.label}</span>
                    </div>
                  )}
                  <button
                    onClick={() => { setDeleteTarget(null); setShowDeleteRecordConfirm(true); }}
                    disabled={deletingRecord}
                    title="Delete entire record"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: '28px', height: '28px', borderRadius: '6px',
                      border: '1px solid #FCA5A5', backgroundColor: '#FEF2F2',
                      color: '#DC2626', cursor: 'pointer', opacity: deletingRecord ? 0.6 : 1,
                    }}
                  >
                    <Trash2 width={13} height={13} />
                  </button>
                </div>
              </div>

              {/* Images */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.08em' }}>VERIFICATION IMAGES</span>
                  {(selected.idDocumentUrl || selected.webcamCaptureUrl) && (
                    <button
                      onClick={() => setShowDeleteImgsConfirm(true)}
                      disabled={deletingImgs}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 8px',
                        borderRadius: '6px', border: '1px solid #FCA5A5', backgroundColor: '#FEF2F2',
                        color: '#DC2626', fontSize: '11px', fontWeight: 500, cursor: 'pointer',
                        opacity: deletingImgs ? 0.6 : 1,
                      }}
                    >
                      <Trash2 width={11} height={11} />
                      {deletingImgs ? 'Deleting...' : 'Delete images'}
                    </button>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <p style={{ fontSize: '10px', fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.06em', margin: '0 0 6px' }}>ID DOCUMENT</p>
                    <VerifImg src={selected.idDocumentUrl} alt="ID Document" icon="document" />
                  </div>
                  <div>
                    <p style={{ fontSize: '10px', fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.06em', margin: '0 0 6px' }}>WEBCAM CAPTURE</p>
                    <VerifImg src={selected.webcamCaptureUrl} alt="Webcam capture" icon="camera" />
                  </div>
                </div>
              </div>

              {/* Face match confidence */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>Face match confidence</span>
                  <span style={{ fontSize: '16px', fontWeight: 700, color: hasConf ? confColor : '#9CA3AF' }}>
                    {hasConf ? `${Math.round(conf)}%` : '-'}
                  </span>
                </div>
                <div style={{ height: '6px', borderRadius: '3px', backgroundColor: 'var(--admin-border)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: hasConf ? `${Math.min(100, conf)}%` : '0%', backgroundColor: confColor, borderRadius: '3px', transition: 'width 0.4s ease' }} />
                </div>
              </div>

              {/* Checks */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '22px' }}>
                <CheckRow label="Name match"     pass={selected.checks?.nameMatch     ?? true} />
                <CheckRow label="Photo match"    pass={selected.checks?.photoMatch    ?? false} />
                <CheckRow label="Document valid" pass={selected.checks?.documentValid ?? true} />
                <CheckRow label="Not expired"    pass={selected.checks?.notExpired    ?? true} />
              </div>

              {/* Action buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <button
                  onClick={() => setShowReject(true)}
                  disabled={rejecting || selected.status === 'mismatch'}
                  style={{
                    padding: '12px', borderRadius: '10px', border: 'none',
                    backgroundColor: selected.status === 'mismatch' ? '#FCA5A5' : '#EF4444',
                    color: 'white', fontSize: '14px', fontWeight: 600,
                    cursor: selected.status === 'mismatch' ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    opacity: rejecting ? 0.7 : 1,
                  }}>
                  <XCircle width={16} height={16} />
                  {rejecting ? 'Rejecting...' : 'Reject'}
                </button>
                <button
                  onClick={handleApprove}
                  disabled={approving || selected.status === 'verified'}
                  style={{
                    padding: '12px', borderRadius: '10px', border: 'none',
                    backgroundColor: selected.status === 'verified' ? 'var(--admin-accent-disabled)' : 'var(--admin-accent)',
                    color: 'white', fontSize: '14px', fontWeight: 600,
                    cursor: selected.status === 'verified' ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    opacity: approving ? 0.7 : 1,
                  }}>
                  <CheckCircle2 width={14} height={14} />
                  {approving ? 'Approving...' : 'Approve & verify'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* -- Modals -- */}
      {showReject && (
        <RejectModal onConfirm={handleReject} onCancel={() => setShowReject(false)} />
      )}
      {showDeleteImgsConfirm && (
        <ConfirmModal
          title="Delete verification images?"
          body="This will permanently remove the stored ID document and webcam capture images. The verification record will remain."
          confirmLabel="Delete images"
          confirmColor="#EF4444"
          onConfirm={handleDeleteImages}
          onCancel={() => setShowDeleteImgsConfirm(false)}
        />
      )}
      {showDeleteRecordConfirm && (
        <ConfirmModal
          title="Delete entire verification record?"
          body={`This will permanently delete all verification data for ${deleteTarget?.name ?? selected?.candidateName ?? 'this candidate'}, including images. This cannot be undone.`}
          confirmLabel="Delete record"
          confirmColor="#EF4444"
          onConfirm={handleDeleteRecord}
          onCancel={() => { setShowDeleteRecordConfirm(false); setDeleteTarget(null); }}
        />
      )}
    </div>
  );
}
