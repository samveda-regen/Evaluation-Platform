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

export default function TestAIProctoring() {
  const { testId } = useParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<Test | null>(null);
  const [proctorEnabled, setProctorEnabled] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<string[]>([...DEFAULT_CUSTOM_AI_VIOLATIONS]);

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
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">CUSTOM AI</h3>
              <p className="text-sm text-slate-500">
                Select exactly which AI violations should be active during this exam.
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

          <div className="grid gap-3 md:grid-cols-2">
            {CUSTOM_AI_VIOLATION_OPTIONS.map((option) => {
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
      )}

      {!proctorEnabled && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          Enable AI proctoring to configure the <span className="font-semibold">CUSTOM AI</span> violation checkboxes.
        </div>
      )}
    </div>
  );
}

