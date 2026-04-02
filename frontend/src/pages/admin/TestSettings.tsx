import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { Test } from '../../types';

type SettingsState = {
  proctorEnabled: boolean;
  requireCamera: boolean;
  requireMicrophone: boolean;
  requireScreenShare: boolean;
  requireIdVerification: boolean;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  allowMultipleAttempts: boolean;
};

const defaultSettings: SettingsState = {
  proctorEnabled: true,
  requireCamera: true,
  requireMicrophone: true,
  requireScreenShare: false,
  requireIdVerification: false,
  shuffleQuestions: false,
  shuffleOptions: false,
  allowMultipleAttempts: false
};

export default function TestSettings() {
  const { testId } = useParams();
  const [test, setTest] = useState<Test | null>(null);
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activePanel, setActivePanel] = useState<'general' | 'test_integrity' | 'emails'>('test_integrity');
  const [generalForm, setGeneralForm] = useState({
    jobLink: '',
    role: 'Back-End Developer',
    workExperience: '',
    testLabel: '',
    language: 'English (en)',
    startTime: '',
    endTime: ''
  });

  useEffect(() => {
    if (!testId) return;
    loadTest();
  }, [testId]);

  const loadTest = async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.getTest(testId!);
      const loaded = data.test as Test;
      setTest(loaded);
      setSettings({
        proctorEnabled: loaded.proctorEnabled ?? true,
        requireCamera: loaded.requireCamera ?? true,
        requireMicrophone: loaded.requireMicrophone ?? true,
        requireScreenShare: loaded.requireScreenShare ?? false,
        requireIdVerification: loaded.requireIdVerification ?? false,
        shuffleQuestions: loaded.shuffleQuestions ?? false,
        shuffleOptions: loaded.shuffleOptions ?? false,
        allowMultipleAttempts: loaded.allowMultipleAttempts ?? false
      });
    } catch (error) {
      toast.error('Failed to load test settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (nextSettings: SettingsState) => {
    if (!testId) return;
    setSaving(true);
    try {
      await adminApi.updateTest(testId, nextSettings);
      toast.success('Settings updated');
    } catch (error) {
      toast.error('Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const updateSetting = (key: keyof SettingsState) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      void handleSave(next);
      return next;
    });
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
        <span className="text-slate-600">Settings</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">
            {test.name}
            <span className="ml-2 text-slate-400">✎</span>
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Share
          </button>
          <button className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Try Test
          </button>
          <Link
            to={`/admin/tests/${testId}?tab=candidates`}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Invite
          </Link>
          <button className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50">
            ⋯
          </button>
          {saving && <span className="self-center text-xs text-slate-400">Saving…</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-6 border-b border-slate-200 text-sm">
        <Link
          to={`/admin/tests/${testId}`}
          className="pb-3 font-semibold text-slate-500 hover:text-slate-900"
        >
          Questions
        </Link>
        <Link
          to={`/admin/tests/${testId}?tab=candidates`}
          className="pb-3 font-semibold text-slate-500 hover:text-slate-900"
        >
          Candidates
        </Link>
        <Link
          to={`/admin/tests/${testId}/analytics`}
          className="pb-3 font-semibold text-slate-500 hover:text-slate-900"
        >
          Insights
        </Link>
        <span className="relative pb-3 font-semibold text-slate-900 after:absolute after:-bottom-[1px] after:left-0 after:h-[3px] after:w-full after:bg-emerald-500">
          Settings
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px,1fr]">
        <aside className="border-r border-slate-200 pr-4">
          <div className="space-y-3 text-sm text-slate-600">
            <button
              onClick={() => setActivePanel('general')}
              className={`w-full py-2 text-left ${activePanel === 'general' ? 'rounded-lg bg-slate-50 px-3 text-slate-900 border-l-2 border-emerald-500' : ''}`}
            >
              General
            </button>
            <div className="py-2 font-semibold text-slate-900">Test Content</div>
            <div className="py-2">Questions</div>
            <div className="py-2">Sections</div>
            <div className="py-2">Evaluation</div>
            <div className="pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Test Administration</div>
            <div className="py-2">Onboarding</div>
            <button
              onClick={() => setActivePanel('emails')}
              className={`w-full py-2 text-left ${activePanel === 'emails' ? 'rounded-lg bg-slate-50 px-3 text-slate-900 border-l-2 border-emerald-500' : ''}`}
            >
              Emails
            </button>
            <button
              onClick={() => setActivePanel('test_integrity')}
              className={`w-full py-2 text-left ${activePanel === 'test_integrity' ? 'rounded-lg bg-slate-50 px-3 text-slate-900 border-l-2 border-emerald-500' : ''}`}
            >
              Test Integrity
            </button>
            <div className="py-2">Test Invites</div>
          </div>
        </aside>

        <div className="space-y-6">
          {activePanel === 'general' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">General</h2>
              </div>

              <div className="space-y-5 max-w-2xl">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Job Description Link</label>
                  <input
                    type="text"
                    value={generalForm.jobLink}
                    onChange={(event) => setGeneralForm((prev) => ({ ...prev, jobLink: event.target.value }))}
                    placeholder="Add a link to the job description"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">What role is this test for?</label>
                  <select
                    value={generalForm.role}
                    onChange={(event) => setGeneralForm((prev) => ({ ...prev, role: event.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  >
                    <option>Back-End Developer</option>
                    <option>Front-End Developer</option>
                    <option>Full-Stack Developer</option>
                    <option>Data Analyst</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Work Experience</label>
                  <select
                    value={generalForm.workExperience}
                    onChange={(event) => setGeneralForm((prev) => ({ ...prev, workExperience: event.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  >
                    <option value="">Select a work experience</option>
                    <option value="0-2">0-2 years</option>
                    <option value="2-5">2-5 years</option>
                    <option value="5-8">5-8 years</option>
                    <option value="8+">8+ years</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Test label</label>
                  <input
                    type="text"
                    value={generalForm.testLabel}
                    onChange={(event) => setGeneralForm((prev) => ({ ...prev, testLabel: event.target.value }))}
                    placeholder="Enter a custom label"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Candidate facing language <span className="text-slate-400">ⓘ</span>
                  </label>
                  <select
                    value={generalForm.language}
                    onChange={(event) => setGeneralForm((prev) => ({ ...prev, language: event.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  >
                    <option>English (en)</option>
                    <option>Spanish (es)</option>
                    <option>German (de)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Test Expiration Time</label>
                  <p className="text-xs text-slate-500 mb-3">Your account timezone: Asia/Calcutta</p>
                  <div className="grid gap-3 sm:grid-cols-[1fr,auto,1fr] items-center">
                    <input
                      type="text"
                      value={generalForm.startTime}
                      onChange={(event) => setGeneralForm((prev) => ({ ...prev, startTime: event.target.value }))}
                      placeholder="Start date & time"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    />
                    <span className="text-sm text-slate-500 text-center">to</span>
                    <input
                      type="text"
                      value={generalForm.endTime}
                      onChange={(event) => setGeneralForm((prev) => ({ ...prev, endTime: event.target.value }))}
                      placeholder="End date & time"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activePanel === 'test_integrity' && (
            <>
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Test Integrity</h2>
                <p className="text-sm text-slate-500 mt-1">Select your Mode</p>
                <p className="text-sm text-slate-500 mt-2">
                  Choose a mode to set the level of test monitoring. Regardless of the selected mode, we always track
                  copy/paste and tab switching for compliance.
                </p>
              </div>

              <div className="space-y-6">
                <ToggleRow
                  label="Enable live AI proctoring"
                  description="Includes AI-powered monitoring and anomaly detection."
                  checked={settings.proctorEnabled}
                  onToggle={() => updateSetting('proctorEnabled')}
                />
                <ToggleRow
                  label="Require camera access"
                  description="Require candidates to keep their camera on during the test."
                  checked={settings.requireCamera}
                  onToggle={() => updateSetting('requireCamera')}
                />
                <ToggleRow
                  label="Require microphone access"
                  description="Require candidates to keep their microphone on during the test."
                  checked={settings.requireMicrophone}
                  onToggle={() => updateSetting('requireMicrophone')}
                />
                <ToggleRow
                  label="Require screen share"
                  description="Ask candidates to share their screen while attempting the test."
                  checked={settings.requireScreenShare}
                  onToggle={() => updateSetting('requireScreenShare')}
                />
                <ToggleRow
                  label="Require ID verification before test"
                  description="Verify candidate identity before they can start the test."
                  checked={settings.requireIdVerification}
                  onToggle={() => updateSetting('requireIdVerification')}
                />
                <ToggleRow
                  label="Shuffle questions for each candidate"
                  description="Randomize the question order for every attempt."
                  checked={settings.shuffleQuestions}
                  onToggle={() => updateSetting('shuffleQuestions')}
                />
                <ToggleRow
                  label="Shuffle MCQ options"
                  description="Randomize the order of options for MCQs."
                  checked={settings.shuffleOptions}
                  onToggle={() => updateSetting('shuffleOptions')}
                />
                <ToggleRow
                  label="Allow multiple attempts"
                  description="Allow candidates to attempt this test multiple times."
                  checked={settings.allowMultipleAttempts}
                  onToggle={() => updateSetting('allowMultipleAttempts')}
                />
              </div>
            </>
          )}

          {activePanel === 'emails' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">Confirmation Email</h2>
                  <p className="text-sm text-slate-500">
                    This email will be sent to the candidate when they complete the test.
                  </p>
                </div>
                <button className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 text-slate-600">
                  ▾
                </button>
              </div>

              <div className="rounded-2xl border border-slate-300 bg-white">
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 text-sm text-slate-500">
                  <span>↺</span>
                  <span>↻</span>
                  <span className="h-4 w-px bg-slate-200" />
                  <span className="font-semibold">B</span>
                  <span className="italic">I</span>
                  <span className="underline">U</span>
                  <span className="line-through">S</span>
                  <span>🔗</span>
                  <span className="h-4 w-px bg-slate-200" />
                  <span>1·</span>
                  <span>•</span>
                  <span>≡</span>
                  <span className="h-4 w-px bg-slate-200" />
                  <span>Normal ▾</span>
                  <span>Arial ▾</span>
                  <span>14px ▾</span>
                  <span>Add Field ▾</span>
                  <span className="ml-auto">🖼</span>
                </div>
                <textarea
                  className="min-h-[240px] w-full rounded-b-2xl px-5 py-4 text-sm text-slate-700 outline-none"
                  defaultValue={`Hello,\n\nThanks for completing ${test.name}. We've sent your submission to .\n\nIn the meantime, you can go ahead and solve more of such code challenges on HackerRank. Solving code challenges is a great way to keep your skills sharp for interviews.\n\nWish you all the best for your test result!\n\nThis is an automated message. Please do not reply to this. You'll need to contact directly for any follow-up questions.\n\nThanks,\nRegen Team`}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onToggle
}: {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="flex items-start gap-3">
        <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-xs text-slate-400">
          ⓘ
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">{label}</p>
          <p className="text-xs text-slate-500">{description}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        className={`relative h-7 w-12 rounded-full transition ${
          checked ? 'bg-emerald-500' : 'bg-slate-200'
        }`}
        aria-pressed={checked}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition ${
            checked ? 'left-6' : 'left-1'
          }`}
        />
      </button>
    </div>
  );
}
