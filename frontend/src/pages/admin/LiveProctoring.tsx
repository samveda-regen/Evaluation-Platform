import {
  AlertTriangle,
  ChevronDown,
  Eye,
  Mic,
  Monitor,
  Radio,
  Search,
  ShieldCheck,
} from 'lucide-react';

interface DemoCandidate {
  initials: string;
  name: string;
  role: string;
  trust: number;
  question: string;
  warning?: string;
  highlighted?: boolean;
}

const demoCandidates: DemoCandidate[] = [
  { initials: 'DC', name: 'Daniel Cruz', role: 'Data Analyst - SQL', trust: 88, question: 'Q12 / 20' },
  { initials: 'PP', name: 'Priya Patel', role: 'Full-Stack Engineer', trust: 72, question: 'Q8 / 23' },
  { initials: 'ML', name: 'Marcus Lee', role: 'Back-End Developer', trust: 54, question: 'Q5 / 23', warning: 'Phone detected', highlighted: true },
  { initials: 'NK', name: 'Nina Kovac', role: 'Front-End Developer', trust: 91, question: 'Q15 / 19' },
  { initials: 'SA', name: 'Sara Ahmed', role: 'Data Analyst - SQL', trust: 80, question: 'Q3 / 20' },
  { initials: 'TB', name: 'Tom Becker', role: 'Back-End Developer', trust: 66, question: 'Q19 / 23' },
];

function trustColor(score: number) {
  if (score >= 80) return '#059669';
  if (score >= 65) return '#D97706';
  return '#E11D48';
}

function LiveTile({ candidate }: { candidate: DemoCandidate }) {
  return (
    <div
      style={{
        backgroundColor: 'white',
        border: candidate.highlighted ? '2px solid #FDA4AF' : '1px solid var(--admin-border-soft)',
        borderRadius: '14px',
        boxShadow: candidate.highlighted
          ? '0 14px 32px rgba(225, 29, 72, 0.12)'
          : '0 12px 28px rgba(17, 22, 42, 0.08)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'relative',
          height: '200px',
          background: 'linear-gradient(145deg, #101827 0%, #17243A 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '12px',
            left: '12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 9px',
            borderRadius: '7px',
            backgroundColor: '#E11D48',
            color: 'white',
            fontSize: '10px',
            fontWeight: 800,
            letterSpacing: '0.02em',
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'white' }} />
          LIVE
        </div>

        <div style={{ position: 'absolute', top: '10px', right: '10px', display: 'flex', gap: '6px' }}>
          {[Mic, Monitor].map((IconCmp, index) => (
            <button
              key={index}
              type="button"
              title={index === 0 ? 'Microphone active' : 'Screen visible'}
              aria-label={index === 0 ? 'Microphone active' : 'Screen visible'}
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.08)',
                backgroundColor: 'rgba(0,0,0,0.36)',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconCmp size={13} />
            </button>
          ))}
        </div>

        <div
          style={{
            width: '66px',
            height: '66px',
            borderRadius: '50%',
            backgroundColor: 'rgba(255,255,255,0.10)',
            border: '1px solid rgba(255,255,255,0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: '13px',
            fontWeight: 800,
          }}
        >
          {candidate.initials}
        </div>

        {candidate.warning && (
          <div
            style={{
              position: 'absolute',
              left: '12px',
              bottom: '12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 10px',
              borderRadius: '7px',
              backgroundColor: '#E11D48',
              color: 'white',
              fontSize: '11px',
              fontWeight: 700,
            }}
          >
            <AlertTriangle size={12} />
            {candidate.warning}
          </div>
        )}

        <span
          style={{
            position: 'absolute',
            right: '10px',
            bottom: '12px',
            padding: '3px 8px',
            borderRadius: '6px',
            backgroundColor: 'rgba(0,0,0,0.62)',
            color: 'white',
            fontSize: '11px',
            fontWeight: 800,
          }}
        >
          {candidate.question}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '15px 14px 16px' }}>
        <div
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            backgroundColor: 'var(--admin-accent)',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {candidate.initials}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, color: 'var(--admin-text)', fontSize: '14px', fontWeight: 800, lineHeight: 1.25 }}>
            {candidate.name}
          </p>
          <p style={{ margin: '2px 0 0', color: 'var(--admin-text-subtle)', fontSize: '12px', lineHeight: 1.25 }}>
            {candidate.role}
          </p>
        </div>
        <div style={{ textAlign: 'center', flexShrink: 0, width: '42px' }}>
          <p style={{ margin: 0, color: trustColor(candidate.trust), fontSize: '17px', fontWeight: 900, lineHeight: 1 }}>
            {candidate.trust}
          </p>
          <p style={{ margin: '3px 0 0', color: 'var(--admin-text-subtle)', fontSize: '10px', lineHeight: 1 }}>
            trust
          </p>
        </div>
        <button
          type="button"
          title="Preview session"
          aria-label="Preview session"
          style={{
            width: '34px',
            height: '34px',
            borderRadius: '9px',
            border: '1px solid var(--admin-border-soft)',
            backgroundColor: 'white',
            color: 'var(--admin-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Eye size={15} />
        </button>
      </div>
    </div>
  );
}

export default function LiveProctoring() {
  return (
    <div style={{ backgroundColor: '#F9FAFB', minHeight: '100%' }}>
      <div className="admin-page-header" style={{ marginBottom: '24px' }}>
        <div className="admin-page-heading">
          <div>
            <h1 className="admin-page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span>Live Proctoring</span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  height: '24px',
                  padding: '0 10px',
                  borderRadius: '999px',
                  backgroundColor: '#FFF7ED',
                  border: '1px solid #FED7AA',
                  color: '#C45F20',
                  fontSize: '11px',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                Coming Soon
              </span>
            </h1>
            <p className="admin-page-subtitle">
              A visual demo of real-time candidate monitoring, trust signals, and live session alerts.
            </p>
          </div>
        </div>

        <div className="admin-header-actions">
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            style={{ color: '#047857', borderColor: '#A7F3D0', backgroundColor: '#ECFDF5' }}
          >
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#34D399' }} />
            6 live
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
          >
            Back-End Developer - No
            <ChevronDown size={15} color="var(--admin-text-subtle)" />
          </button>
        </div>
      </div>

      <div
        style={{
          marginBottom: '24px',
          padding: '14px 16px',
          borderRadius: '12px',
          border: '1px solid #BFDBFE',
          background: 'linear-gradient(90deg, #EFF6FF 0%, #F8FAFC 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '9px',
              backgroundColor: 'var(--admin-accent)',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ShieldCheck size={17} />
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, color: 'var(--admin-text)', fontSize: '13px', fontWeight: 800 }}>
              Feature preview
            </p>
            <p style={{ margin: '1px 0 0', color: 'var(--admin-text-muted)', fontSize: '12px' }}>
              This preview shows how live proctoring will look once the feature is enabled.
            </p>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: 'min(100%, 320px)',
            height: '36px',
            borderRadius: 'var(--admin-field-radius)',
            border: '1px solid var(--admin-border)',
            backgroundColor: 'white',
            padding: '0 11px',
            color: 'var(--admin-text-subtle)',
            fontSize: '13px',
          }}
        >
          <Search size={15} />
          <span>Search live sessions...</span>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '16px',
        }}
      >
        {demoCandidates.map(candidate => (
          <LiveTile key={candidate.name} candidate={candidate} />
        ))}
      </div>
    </div>
  );
}
