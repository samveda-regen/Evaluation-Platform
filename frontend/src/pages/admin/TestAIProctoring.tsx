import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import type { Test } from '../../types';
import {
  CUSTOM_AI_VIOLATION_OPTIONS,
  DEFAULT_CUSTOM_AI_VIOLATIONS,
  normalizeCustomAIViolationSelection,
  filterViolationsForAssessmentMode,
  isSebRedundantViolation,
} from '../../constants/customAIViolations';
import { Camera, Mic, MonitorPlay, Maximize2, AlertTriangle, CheckCircle2 } from 'lucide-react';

/* -- Severity config per violation -- */
type Severity = 'High' | 'Medium' | 'Low';
const VIOLATION_META: Record<string, { label: string; desc: string; severity: Severity }> = {
  face_not_detected:             { label: 'Face not detected',      desc: 'No faces in frame for 5s',                 severity: 'High'   },
  multiple_faces:                { label: 'Multiple faces',         desc: 'More than one person detected',             severity: 'High'   },
  looking_away:                  { label: 'Looking away',           desc: 'Gaze off-screen repeatedly',                severity: 'Medium' },
  tab_switch:                    { label: 'Tab / window switch',    desc: 'Candidate leaves the test tab',             severity: 'High'   },
  phone_detected:                { label: 'Phone detected',         desc: 'Mobile device in frame',                    severity: 'High'   },
  voice_detected:                { label: 'Background voice',       desc: 'Speech detected from another person',       severity: 'Medium' },
  copy_paste_attempt:            { label: 'Copy / paste',           desc: 'Clipboard used in answers',                 severity: 'Low'    },
  fullscreen_exit:               { label: 'Full-screen exit',       desc: 'Candidate leaves full-screen',              severity: 'Medium' },
  suspicious_audio:              { label: 'Suspicious audio',       desc: 'Unusual noise patterns around candidate',   severity: 'Medium' },
  unauthorized_object_detected:  { label: 'Unauthorized object',    desc: 'Unauthorized objects in camera frame',      severity: 'High'   },
  camera_blocked:                { label: 'Camera blocked',         desc: 'Camera obstructed or disabled',             severity: 'High'   },
  secondary_monitor_detected:    { label: 'Secondary monitor',      desc: 'Additional external screen detected',       severity: 'High'   },
  window_blur:                   { label: 'Window focus lost',      desc: 'Browser window lost focus',                 severity: 'Medium' },
  devtools_open:                 { label: 'DevTools open',          desc: 'Developer tools detected',                  severity: 'High'   },
  screen_share_stopped:          { label: 'Screen share stopped',   desc: 'Candidate stopped screen sharing',          severity: 'High'   },
};

const SEV_COLOR: Record<Severity, string> = {
  High:   '#EF4444',
  Medium: 'var(--admin-accent)',
  Low:    'var(--admin-text-muted)',
};

/* -- Small reusable toggle -- */
function Toggle({ on, onChange, disabled }: { on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className="admin-toggle"
      data-state={on ? 'on' : 'off'}
      aria-pressed={on}
    >
      <span className="admin-toggle__knob" />
    </button>
  );
}

export default function TestAIProctoring() {
  const { testId } = useParams();

  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [test, setTest]         = useState<Test | null>(null);

  /* -- Core proctoring state -- */
  const [proctorEnabled, setProctorEnabled]   = useState(false);
  const [selectedEvents, setSelectedEvents]   = useState<string[]>([...DEFAULT_CUSTOM_AI_VIOLATIONS]);

  /* -- Monitoring modes -- */
  const [webcamOn,     setWebcamOn]     = useState(true);
  const [micOn,        setMicOn]        = useState(true);
  const [screenOn,     setScreenOn]     = useState(true);
  const [fullscreenOn, setFullscreenOn] = useState(true);

  /* -- Trust scoring -- */
  const [autoFlagThreshold, setAutoFlagThreshold] = useState(60);
  const [warnOnViolation,   setWarnOnViolation]   = useState(true);
  const [captureSnapshot,   setCaptureSnapshot]   = useState(true);
  const [autoSubmit,        setAutoSubmit]         = useState(false);
  const [maxViolations,     setMaxViolations]      = useState(3);

  const MAX_TEST_VIOLATIONS = 150;

  useEffect(() => { if (testId) void loadTest(); }, [testId]);

  const loadTest = async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.getTest(testId!);
      const loaded = data.test as Test;
      setTest(loaded);
      setProctorEnabled(Boolean(loaded.proctorEnabled));
      setSelectedEvents(
        filterViolationsForAssessmentMode(
          normalizeCustomAIViolationSelection(loaded.customAIViolations || DEFAULT_CUSTOM_AI_VIOLATIONS),
          loaded.assessmentMode,
        ),
      );
      setMaxViolations(typeof loaded.maxViolations === 'number' ? loaded.maxViolations : 3);

      /* restore extended proctoring settings */
      const isEnabled = Boolean(loaded.proctorEnabled);
      try {
        const raw = (loaded as unknown as Record<string, unknown>).proctoringSettings;
        const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (p && typeof p === 'object') {
          if (typeof p.autoFlagThreshold === 'number') setAutoFlagThreshold(p.autoFlagThreshold);
          if (typeof p.warnOnViolation   === 'boolean') setWarnOnViolation(p.warnOnViolation);
          if (typeof p.captureSnapshot   === 'boolean') setCaptureSnapshot(p.captureSnapshot);
          if (typeof p.autoSubmit        === 'boolean') setAutoSubmit(p.autoSubmit);
          setWebcamOn(typeof p.webcamOn === 'boolean' ? p.webcamOn : isEnabled);
          setMicOn(typeof p.micOn === 'boolean' ? p.micOn : isEnabled);
          setScreenOn(typeof p.screenOn === 'boolean' ? p.screenOn : isEnabled);
          setFullscreenOn(typeof p.fullscreenOn === 'boolean' ? p.fullscreenOn : isEnabled);
        } else if (isEnabled) {
          setWebcamOn(true); setMicOn(true); setScreenOn(true); setFullscreenOn(true);
        }
      } catch { /* ignore */ }

      // SEB tests never use screen share — SEB's lockdown covers it. Force the
      // Screen tile off regardless of what's stored.
      if (loaded.assessmentMode === 'SEB') setScreenOn(false);

      /* backward compat: violationPopupSettings */
      try {
        const raw = (loaded as unknown as Record<string, unknown>).violationPopupSettings;
        const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (p && typeof p.enabled === 'boolean') setWarnOnViolation(p.enabled);
      } catch { /* ignore */ }

    } catch {
      toast.error('Failed to load AI proctoring settings');
    } finally {
      setLoading(false);
    }
  };

  const selectedSet = useMemo(() => new Set(selectedEvents), [selectedEvents]);

  const toggleEvent = (eventType: string) => {
    setSelectedEvents(prev =>
      prev.includes(eventType)
        ? prev.filter(e => e !== eventType)
        : [...prev, eventType]
    );
  };

  const saveSettings = async () => {
    if (!testId) return;
    setSaving(true);
    try {
      // SEB tests never use screen share — SEB's lockdown covers it. Never send it on.
      const effectiveScreenOn = test?.assessmentMode === 'SEB' ? false : screenOn;
      await adminApi.updateTest(testId, {
        proctorEnabled,
        // Explicitly send device requirements so the candidate "Before you begin"
        // page always reflects the current monitoring tile settings.
        requireCamera: proctorEnabled && webcamOn,
        requireMicrophone: proctorEnabled && micOn,
        requireScreenShare: proctorEnabled && effectiveScreenOn,
        customAIViolations: filterViolationsForAssessmentMode(selectedEvents, test?.assessmentMode),
        // "Auto-submit after 3 warnings" is a fixed built-in cutoff; ignore the
        // custom max-violations count while it's on so the two can't disagree.
        maxViolations: autoSubmit ? 3 : maxViolations,
        proctoringSettings: {
          autoFlagThreshold, warnOnViolation, captureSnapshot, autoSubmit,
          webcamOn, micOn, screenOn: effectiveScreenOn, fullscreenOn,
        },
        violationPopupSettings: { enabled: warnOnViolation, durationSeconds: 2 },
      });
      toast.success('AI proctoring settings saved');
      await loadTest();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--admin-accent)' }} />
      </div>
    );
  }

  const isSeb = test?.assessmentMode === 'SEB';
  // SEB's own kiosk lockdown already blocks tab switching, window blur, full-screen
  // exit, dev tools, clipboard, extra monitors and needs no screen share — so those
  // toggles are hidden for SEB tests and never sent to the server.
  const visibleViolationOptions = isSeb
    ? CUSTOM_AI_VIOLATION_OPTIONS.filter((opt) => !isSebRedundantViolation(opt.eventType))
    : CUSTOM_AI_VIOLATION_OPTIONS;

  const monitorModes = [
    { label: 'Webcam',      icon: <Camera size={22} />,      on: webcamOn,     toggle: () => setWebcamOn(p => !p) },
    { label: 'Microphone',  icon: <Mic size={22} />,         on: micOn,        toggle: () => setMicOn(p => !p) },
    // Screen share isn't offered for SEB tests — SEB's lockdown covers it and
    // getDisplayMedia() is unreliable inside SEB.
    ...(isSeb ? [] : [{ label: 'Screen', icon: <MonitorPlay size={22} />, on: screenOn, toggle: () => setScreenOn(p => !p) }]),
    { label: 'Full-screen', icon: <Maximize2 size={22} />,   on: fullscreenOn, toggle: () => setFullscreenOn(p => !p) },
  ];

  return (
    <div style={{ paddingTop: '4px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 272px', gap: '20px', alignItems: 'start' }}>

          {/* ----------- LEFT COLUMN ----------- */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* -- AI proctoring master card -- */}
            <div style={{ backgroundColor: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div>
                  <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--admin-text)', margin: 0 }}>AI proctoring</p>
                  <p style={{ fontSize: '12px', color: 'var(--admin-text-muted)', marginTop: '4px', margin: '4px 0 0' }}>
                    Webcam + screen monitoring with automatic violation detection.
                  </p>
                </div>
                <Toggle on={proctorEnabled} onChange={() => {
                  const next = !proctorEnabled;
                  setProctorEnabled(next);
                  if (next) { setWebcamOn(true); setMicOn(true); setScreenOn(!isSeb); setFullscreenOn(true); }
                }} />
              </div>

              {/* Monitoring mode tiles */}
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${monitorModes.length}, 1fr)`, gap: '10px' }}>
                {monitorModes.map(({ label, icon, on, toggle }) => {
                  const active = on && proctorEnabled;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={proctorEnabled ? toggle : undefined}
                      style={{
                        backgroundColor: active ? 'var(--admin-accent-soft)' : '#F9FAFB',
                        border: `1.5px solid ${active ? 'var(--admin-accent-disabled)' : 'var(--admin-border)'}`,
                        borderRadius: '12px',
                        padding: '14px 8px',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
                        cursor: proctorEnabled ? 'pointer' : 'default',
                        transition: 'all 0.15s',
                        opacity: !proctorEnabled ? 0.6 : 1,
                      }}>
                      <span style={{ color: active ? 'var(--admin-accent)' : 'var(--admin-text-subtle)' }}>{icon}</span>
                      <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--admin-text-muted)' }}>{label}</span>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: active ? 'var(--admin-accent)' : 'var(--admin-text-subtle)' }}>
                        {active ? 'On' : 'Off'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* -- Violation rules card -- */}
            <div style={{ backgroundColor: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--admin-text)', margin: 0 }}>Violation rules</p>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--admin-text-muted)', marginTop: '4px', marginBottom: '16px' }}>
                Toggle what counts against the trust score.
              </p>

              {isSeb && (
                <p style={{ fontSize: '11px', color: 'var(--admin-text-subtle)', marginTop: '-8px', marginBottom: '16px', lineHeight: 1.5 }}>
                  Tab switch, window focus, full-screen exit, dev tools, copy/paste, secondary
                  monitor and screen-share checks aren't shown here — Safe Exam Browser's own
                  lockdown already prevents them. Only camera and microphone checks apply in SEB mode.
                </p>
              )}

              {/* Violation rows */}
              <div>
                {visibleViolationOptions.map((opt, idx) => {
                  const meta = VIOLATION_META[opt.eventType] ?? {
                    label: opt.label, desc: opt.description, severity: 'Medium' as Severity,
                  };
                  const on = selectedSet.has(opt.eventType);
                  const sevColor = SEV_COLOR[meta.severity];
                  const isLast = idx === visibleViolationOptions.length - 1;

                  return (
                    <div key={opt.eventType} style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '12px 0',
                      borderBottom: isLast ? 'none' : '1px solid #F9FAFB',
                    }}>
                      <AlertTriangle size={16} style={{ flexShrink: 0, color: 'var(--admin-accent)' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--admin-text)', margin: 0 }}>{meta.label}</p>
                        <p style={{ fontSize: '11px', color: 'var(--admin-text-subtle)', marginTop: '2px', margin: '2px 0 0' }}>{meta.desc}</p>
                      </div>
                      <span style={{
                        fontSize: '12px', fontWeight: 600, color: sevColor,
                        whiteSpace: 'nowrap', width: '105px', textAlign: 'right',
                      }}>
                        {meta.severity} severity
                      </span>
                      <Toggle on={on} onChange={() => toggleEvent(opt.eventType)} />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ----------- RIGHT SIDEBAR ----------- */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Trust scoring card */}
            <div style={{ backgroundColor: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--admin-text)', margin: '0 0 16px' }}>Trust scoring</p>

              {/* Auto-flag slider */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--admin-text-muted)' }}>Auto-flag threshold</span>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--admin-text)' }}>{autoFlagThreshold}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={autoFlagThreshold}
                  onChange={e => setAutoFlagThreshold(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--admin-button-primary)', cursor: 'pointer' }}
                />
                <p style={{ fontSize: '11px', color: 'var(--admin-text-subtle)', marginTop: '6px' }}>
                  Attempts below this trust score are flagged for review
                </p>
              </div>

              <div style={{ borderTop: '1px solid var(--admin-border)', margin: '0 0 14px' }} />

              {/* On violation checkboxes */}
              <p style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--admin-text-muted)', margin: '0 0 12px' }}>
                On violation
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[
                  { label: 'Warn candidate on screen',    state: warnOnViolation, set: setWarnOnViolation },
                  { label: 'Capture evidence snapshot',  state: captureSnapshot,  set: setCaptureSnapshot },
                  { label: 'Auto-submit after 3 warnings', state: autoSubmit,     set: setAutoSubmit },
                ].map(({ label, state, set }) => (
                  <label key={label} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                    <div
                      onClick={() => set(p => !p)}
                      className="admin-square-toggle"
                      data-state={state ? 'on' : 'off'}
                      style={{ cursor: 'pointer' }}>
                      {state && (
                        <CheckCircle2 width={10} height={10} style={{ color: 'white' }} />
                      )}
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--admin-text-muted)' }}>{label}</span>
                  </label>
                ))}
              </div>

              <div style={{ borderTop: '1px solid var(--admin-border)', margin: '14px 0' }} />

              {/* Max violations */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--admin-text)' }}>Max violations</span>
                <input
                  type="number"
                  min={1}
                  max={MAX_TEST_VIOLATIONS}
                  value={maxViolations}
                  disabled={autoSubmit}
                  onChange={e => setMaxViolations(Math.max(1, Math.min(MAX_TEST_VIOLATIONS, Number(e.target.value) || 1)))}
                  style={{
                    width: '64px', padding: '6px 8px', borderRadius: '8px',
                    border: '1.5px solid var(--admin-border)', fontSize: '13px', textAlign: 'center',
                    color: 'var(--admin-text)', outline: 'none',
                    backgroundColor: autoSubmit ? 'var(--admin-surface-soft)' : 'white',
                    cursor: autoSubmit ? 'not-allowed' : 'text',
                  }}
                />
              </div>
              <p style={{ fontSize: '11px', color: autoSubmit ? '#DC2626' : 'var(--admin-text-subtle)', margin: 0 }}>
                {autoSubmit
                  ? 'Disabled — "Auto-submit after 3 warnings" already ends the attempt at 3.'
                  : 'The attempt is auto-submitted once violations reach this count.'}
              </p>
            </div>

            {/* Candidate consent card */}
            <div style={{
              borderRadius: '14px', padding: '16px',
              backgroundColor: 'var(--admin-accent-soft)', border: '1px solid var(--admin-accent-disabled)',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, color: 'var(--admin-accent-hover)' }} />
                <div>
                  <p style={{ fontSize: '12px', fontWeight: 700, color: '#92400E', margin: '0 0 4px' }}>Candidate consent</p>
                  <p style={{ fontSize: '11px', color: '#92400E', lineHeight: '1.6', margin: 0 }}>
                    Candidates must accept camera &amp; screen recording before starting. Required by privacy policy.
                  </p>
                </div>
              </div>
            </div>

            {/* Save button */}
            <button
              type="button"
              onClick={saveSettings}
              disabled={saving}
              style={{
                width: '100%', padding: '10px',
                borderRadius: '12px', border: 'none',
                backgroundColor: saving ? 'var(--admin-accent-disabled)' : 'var(--admin-accent)',
                color: 'white', fontSize: '14px', fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer',
                transition: 'background-color 0.15s',
              }}>
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
    </div>
  );
}
