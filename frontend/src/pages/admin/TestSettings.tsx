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

const DEFAULT_INVITATION_SUBJECT = 'You are invited to take {{testName}}';
const DEFAULT_INVITATION_BODY = [
  'Hi {{candidateName}},',
  '',
  'You have been invited to take the test "{{testName}}".',
  'Click the link below to start:',
  '{{testLink}}',
  '',
  '{{customMessage}}',
  '',
  'Good luck!'
].join('\n');

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
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailDirty, setEmailDirty] = useState(false);
  const [emailSubject, setEmailSubject] = useState(DEFAULT_INVITATION_SUBJECT);
  const [emailBody, setEmailBody] = useState(DEFAULT_INVITATION_BODY);
  const [previewEmail, setPreviewEmail] = useState('');
  const [previewSending, setPreviewSending] = useState(false);
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
      setEmailSubject(loaded.invitationEmailSubject ?? DEFAULT_INVITATION_SUBJECT);
      setEmailBody(loaded.invitationEmailBody ?? DEFAULT_INVITATION_BODY);
      setEmailDirty(false);
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

  const handleEmailSave = async () => {
    if (!testId) return;
    setEmailSaving(true);
    try {
      await adminApi.updateTest(testId, {
        invitationEmailSubject: emailSubject.trim(),
        invitationEmailBody: emailBody.trim()
      });
      toast.success('Invitation email template updated');
      setEmailDirty(false);
    } catch (error) {
      toast.error('Failed to update invitation email template');
    } finally {
      setEmailSaving(false);
    }
  };

  const resetEmailTemplate = () => {
    setEmailSubject(DEFAULT_INVITATION_SUBJECT);
    setEmailBody(DEFAULT_INVITATION_BODY);
    setEmailDirty(true);
  };

  const handleSendPreview = async () => {
    if (!testId) return;
    const targetEmail = previewEmail.trim();
    if (!targetEmail) {
      toast.error('Enter an email address to send the preview');
      return;
    }

    setPreviewSending(true);
    try {
      if (emailDirty) {
        await adminApi.updateTest(testId, {
          invitationEmailSubject: emailSubject.trim(),
          invitationEmailBody: emailBody.trim()
        });
        setEmailDirty(false);
      }

      await adminApi.sendTestEmail(testId, { email: targetEmail });
      toast.success('Preview email sent');
    } catch (error) {
      toast.error('Failed to send preview email');
    } finally {
      setPreviewSending(false);
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
                  <h2 className="text-xl font-semibold text-slate-900">Invitation Email</h2>
                  <p className="text-sm text-slate-500">
                    This email will be sent to candidates when you invite them to the test.
                  </p>
                </div>
                <button className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 text-slate-600">
                  ▾
                </button>
              </div>

              <div className="rounded-2xl border border-slate-300 bg-white">
                <div className="border-b border-slate-200 px-5 py-4">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Subject
                  </label>
                  <input
                    className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-500"
                    value={emailSubject}
                    onChange={(event) => {
                      setEmailSubject(event.target.value);
                      setEmailDirty(true);
                    }}
                    placeholder="Subject line"
                  />
                </div>
                <div className="px-5 py-4">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Body
                  </label>
                  <textarea
                    className="mt-2 min-h-[240px] w-full rounded-lg border border-slate-200 px-3 py-3 text-sm text-slate-700 outline-none focus:border-emerald-500"
                    value={emailBody}
                    onChange={(event) => {
                      setEmailBody(event.target.value);
                      setEmailDirty(true);
                    }}
                    placeholder="Write your invitation email"
                  />
                  <p className="mt-3 text-xs text-slate-500">
                    Available fields: <span className="font-mono">{'{{candidateName}}'}</span>,{' '}
                    <span className="font-mono">{'{{testName}}'}</span>,{' '}
                    <span className="font-mono">{'{{testCode}}'}</span>,{' '}
                    <span className="font-mono">{'{{testLink}}'}</span>,{' '}
                    <span className="font-mono">{'{{customMessage}}'}</span>.
                    If you omit <span className="font-mono">{'{{customMessage}}'}</span>, the custom note will be appended automatically.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
                  <button
                    type="button"
                    onClick={resetEmailTemplate}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Reset to default
                  </button>
                  <button
                    type="button"
                    onClick={handleEmailSave}
                    disabled={!emailDirty || emailSaving}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                      !emailDirty || emailSaving ? 'bg-slate-300' : 'bg-emerald-600 hover:bg-emerald-700'
                    }`}
                  >
                    {emailSaving ? 'Saving...' : 'Save template'}
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Send a Test Email</p>
                    <p className="text-xs text-slate-500">
                      Sends a preview using the saved template. The link in the email is not active.
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <input
                    className="w-full flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-500"
                    placeholder="you@example.com"
                    value={previewEmail}
                    onChange={(event) => setPreviewEmail(event.target.value)}
                  />
                  <button
                    type="button"
                    onClick={handleSendPreview}
                    disabled={previewSending || emailSaving}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                      previewSending || emailSaving ? 'bg-slate-300' : 'bg-emerald-600 hover:bg-emerald-700'
                    }`}
                  >
                    {previewSending ? 'Sending...' : 'Send test'}
                  </button>
                </div>
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
