import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import type { Test } from '../../types';
import {
  CUSTOM_AI_VIOLATION_OPTIONS,
  DEFAULT_CUSTOM_AI_VIOLATIONS,
  normalizeCustomAIViolationSelection,
} from '../../constants/customAIViolations';

function IncognitoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-emerald-700" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 8h16l-1.2-3.5a1.2 1.2 0 0 0-1.1-.8H6.3c-.5 0-.9.3-1.1.8L4 8Z" />
      <path d="M6 13h3.2a2 2 0 0 1 2 2v1.5H6V13Z" />
      <path d="M18 13h-3.2a2 2 0 0 0-2 2v1.5H18V13Z" />
      <path d="M9.2 15h5.6" />
      <path d="M9 13v-.5a3 3 0 0 1 6 0v.5" />
      <path d="M8 20h8" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-violet-700" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

const AI_OPTIONS = CUSTOM_AI_VIOLATION_OPTIONS.filter((o) => o.isAI);
const NON_AI_OPTIONS = CUSTOM_AI_VIOLATION_OPTIONS.filter((o) => !o.isAI);

export default function TestAIProctoring() {
  const { testId } = useParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<Test | null>(null);
  const [proctorEnabled, setProctorEnabled] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<string[]>([...DEFAULT_CUSTOM_AI_VIOLATIONS]);
  const [violationPopupEnabled, setViolationPopupEnabled] = useState(false);
  const [violationPopupDuration, setViolationPopupDuration] = useState(3);

  useEffect(() => {
    if (!testId) return;
    void loadTest();
  }, [testId]);

  const loadTest = async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.getTest(testId!);
      const loaded = data.test as Test;
      setTest(loaded);
      setProctorEnabled(Boolean(loaded.proctorEnabled));
      setSelectedEvents(
        normalizeCustomAIViolationSelection(loaded.customAIViolations || DEFAULT_CUSTOM_AI_VIOLATIONS)
      );
      try {
        const raw = (loaded as unknown as { violationPopupSettings?: unknown }).violationPopupSettings;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed.enabled === 'boolean' && typeof parsed.durationSeconds === 'number') {
          setViolationPopupEnabled(parsed.enabled);
          setViolationPopupDuration(Math.max(1, Math.min(60, parsed.durationSeconds)));
        }
      } catch { /* ignore */ }
    } catch {
      toast.error('Failed to load AI proctoring settings');
    } finally {
      setLoading(false);
    }
  };

  const selectedSet = useMemo(() => new Set(selectedEvents), [selectedEvents]);

  const toggleEvent = (eventType: string) => {
    setSelectedEvents((prev) =>
      prev.includes(eventType)
        ? prev.filter((item) => item !== eventType)
        : [...prev, eventType]
    );
  };

  const selectAll = () => {
    setSelectedEvents([...DEFAULT_CUSTOM_AI_VIOLATIONS]);
  };

  const clearAll = () => {
    setSelectedEvents([]);
  };

  const saveSettings = async () => {
    if (!testId) return;
    setSaving(true);
    try {
      const payload = {
        proctorEnabled,
        customAIViolations: selectedEvents,
        violationPopupSettings: {
          enabled: violationPopupEnabled,
          durationSeconds: violationPopupDuration,
        },
      };
      await adminApi.updateTest(testId, payload);
      toast.success('AI proctoring settings updated');
      await loadTest();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to update AI proctoring settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600"></div>
      </div>
    );
  }

  if (!test) {
    return <div className="text-center py-12 text-slate-500">Test not found.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="text-sm text-slate-500">
        <Link to="/admin/tests" className="text-emerald-600 hover:underline">
          Tests
        </Link>
        <span className="mx-2">›</span>
        <Link to={`/admin/tests/${testId}`} className="text-slate-600 hover:underline">
          {test.name}
        </Link>
        <span className="mx-2">›</span>
        <span className="text-slate-600">AI Proctoring</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">{test.name}</h1>
          <p className="text-sm text-slate-500 mt-1">Customize which AI violations are active for this test.</p>
        </div>
        <button
          type="button"
          onClick={saveSettings}
          disabled={saving}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save AI Settings'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-6 border-b border-slate-200 text-sm">
        <Link to={`/admin/tests/${testId}`} className="pb-3 font-semibold text-slate-500 hover:text-slate-900">
          Questions
        </Link>
        <Link to={`/admin/tests/${testId}?tab=candidates`} className="pb-3 font-semibold text-slate-500 hover:text-slate-900">
          Candidates
        </Link>
        <Link to={`/admin/tests/${testId}/analytics`} className="pb-3 font-semibold text-slate-500 hover:text-slate-900">
          Insights
        </Link>
        <Link to={`/admin/tests/${testId}/settings`} className="pb-3 font-semibold text-slate-500 hover:text-slate-900">
          Settings
        </Link>
        <span className="relative pb-3 font-semibold text-slate-900 after:absolute after:-bottom-[1px] after:left-0 after:h-[3px] after:w-full after:bg-emerald-500">
          AI Proctoring
        </span>
      </div>

      {/* Master toggle */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="mt-1 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 border border-emerald-200">
              <IncognitoIcon />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">AI Proctoring Panel</h2>
              <p className="text-sm text-slate-500">Enable or disable AI monitoring for this test.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setProctorEnabled((prev) => !prev)}
            className={`relative h-7 w-12 rounded-full transition ${proctorEnabled ? 'bg-emerald-500' : 'bg-slate-200'}`}
            aria-pressed={proctorEnabled}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition ${proctorEnabled ? 'left-6' : 'left-1'}`}
            />
          </button>
        </div>
      </div>

      {proctorEnabled && (
        <>
          {/* Custom AI violations — two sections */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">CUSTOM AI</h3>
                <p className="text-sm text-slate-500">
                  Select exactly which violations should be active during this exam.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Clear All
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Enabled violations: <span className="font-semibold text-slate-900">{selectedEvents.length}</span> / {CUSTOM_AI_VIOLATION_OPTIONS.length}
            </div>

            {/* AI-Powered Events */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
                    <circle cx="8" cy="8" r="7" opacity=".2"/>
                    <path d="M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3Zm0 1.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z"/>
                  </svg>
                  AI-Powered Events
                </span>
                <span className="text-xs text-slate-400">Requires camera / microphone model inference</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {AI_OPTIONS.map((option) => {
                  const checked = selectedSet.has(option.eventType);
                  return (
                    <label
                      key={option.eventType}
                      className={`cursor-pointer rounded-xl border p-4 transition ${
                        checked
                          ? 'border-violet-400 bg-violet-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleEvent(option.eventType)}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                        />
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{option.label}</div>
                          <p className="mt-1 text-xs text-slate-500">{option.description}</p>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Browser-Based Events */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
                    <rect x="2" y="3" width="12" height="9" rx="1.5" opacity=".25"/>
                    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h9A1.5 1.5 0 0 1 14 4.5v7A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Zm1.5 0v7h9v-7h-9ZM6 14h4v-1H6v1Z"/>
                  </svg>
                  Browser-Based Events
                </span>
                <span className="text-xs text-slate-400">No model required — browser-native detection</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {NON_AI_OPTIONS.map((option) => {
                  const checked = selectedSet.has(option.eventType);
                  return (
                    <label
                      key={option.eventType}
                      className={`cursor-pointer rounded-xl border p-4 transition ${
                        checked
                          ? 'border-emerald-400 bg-emerald-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleEvent(option.eventType)}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{option.label}</div>
                          <p className="mt-1 text-xs text-slate-500">{option.description}</p>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Violation Pop-up Freeze */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="mt-1 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-violet-50 border border-violet-200">
                  <PauseIcon />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Violation Pop-up Freeze</h3>
                  <p className="text-sm text-slate-500">
                    Freeze the candidate's screen for a set duration when a violation pop-up appears.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViolationPopupEnabled((prev) => !prev)}
                className={`relative h-7 w-12 rounded-full transition ${violationPopupEnabled ? 'bg-violet-500' : 'bg-slate-200'}`}
                aria-pressed={violationPopupEnabled}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition ${violationPopupEnabled ? 'left-6' : 'left-1'}`}
                />
              </button>
            </div>

            {violationPopupEnabled && (
              <div className="flex items-center gap-4 rounded-xl border border-violet-200 bg-violet-50 px-5 py-4">
                <label htmlFor="popup-duration" className="text-sm font-medium text-slate-700 whitespace-nowrap">
                  Screen freeze duration
                </label>
                <input
                  id="popup-duration"
                  type="number"
                  min={1}
                  max={60}
                  value={violationPopupDuration}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(60, Number(e.target.value)));
                    setViolationPopupDuration(Number.isFinite(val) ? val : 3);
                  }}
                  className="w-20 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
                <span className="text-sm text-slate-500">seconds (1 – 60)</span>
              </div>
            )}

            {!violationPopupEnabled && (
              <p className="text-sm text-slate-400">
                Enable to configure how long the screen freezes when a violation popup appears.
              </p>
            )}
          </div>
        </>
      )}

      {!proctorEnabled && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          Enable AI proctoring to configure the <span className="font-semibold">CUSTOM AI</span> violation checkboxes and pop-up freeze settings.
        </div>
      )}
    </div>
  );
}
