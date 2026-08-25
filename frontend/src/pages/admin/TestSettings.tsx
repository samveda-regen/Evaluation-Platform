import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { Test } from '../../types';
import { ChevronRight, Pencil, Check, Trash2, Info } from 'lucide-react';
import DateTimePicker from '../../components/DateTimePicker';
import CustomSelect from '../../components/CustomSelect';

type Panel = 'general' | 'access' |'assessmentmode'| 'behavior' | 'grading' | 'email' | 'danger';

type EmailTab = 'invite' | 'confirm' | 'reminder';

interface EmailTemplateSet {
  inviteEmailSubject: string;
  inviteEmailBody: string;
  confirmEmailSubject: string;
  confirmEmailBody: string;
  reminderEmailSubject: string;
  reminderEmailBody: string;
}

interface EmailTemplates {
  assessmentMode: 'SEB' | 'NORMAL_BROWSER';
  templates: Record<'SEB' | 'NORMAL_BROWSER', EmailTemplateSet>;
  reminderHoursBeforeClose: number;
}

const EMAIL_TAB_LABELS: Record<EmailTab, string> = {
  invite: 'Invite Email',
  confirm: 'Confirmation Email',
  reminder: 'Reminder Email',
};

const EMAIL_TAB_DESCRIPTIONS: Record<EmailTab, string> = {
  invite: 'This email is sent to candidates when you invite them to take the test.',
  confirm: 'This email is sent to candidates when they complete the test.',
  reminder: "This email is sent to candidates who haven't started the test yet, as their access window is closing. It reuses the exact same invite link and access code originally sent to them — no new link is generated.",
};


const AVAILABLE_VARS = [
    { key: '{{seb_install_button}}', desc: 'Install Safe Exam Browser button' },
  { key: '{{seb_continue_button}}', desc: 'Continue to Assessment button' },
  { key: '{{candidate_name}}', desc: 'Candidate full name' },
  { key: '{{test_name}}',      desc: 'Name of the test' },
  { key: '{{company_name}}',   desc: 'Your company name' },
  { key: '{{estimated_time}}', desc: 'Test duration' },
  { key: '{{exam_start}}',     desc: 'Exam opens date & time (invite email only)' },
  { key: '{{exam_end}}',       desc: 'Exam closes date & time (invite email only)' },
  { key: '{{test_link}}',      desc: 'Invite URL — same link originally sent (invite & reminder emails)' },
  { key: '{{access_code}}',    desc: 'Access code (invite & reminder emails)' },
  { key: '{{closes_at}}',      desc: 'When the access window closes (reminder email only)' },
];
const INVITE_ONLY_VAR_KEYS = new Set(['{{exam_start}}', '{{exam_end}}']);
const REMINDER_ONLY_VAR_KEYS = new Set(['{{closes_at}}']);
const INVITE_AND_REMINDER_VAR_KEYS = new Set(['{{test_link}}', '{{access_code}}']);
const SEB_BUTTON_VAR_KEYS = new Set([
  '{{seb_install_button}}',
  '{{seb_continue_button}}',
]);

interface FormState {
  /* General */
  name: string;
  description: string;
  category: string;
  language: string;
  duration: number;
  /* Access & scheduling */
  startTime: string;
  endTime: string;
  requireInvitationLink: boolean;
  limitToOneAttempt: boolean;
  requireIdVerification: boolean;
  autoApproveId: boolean;
  idVerificationAutoApproveThreshold: number;
  allowAccessCode: boolean;
  assessmentMode: 'SEB' | 'NORMAL_BROWSER';
  /* Test behavior */
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showTimer: boolean;
  autoSubmitOnTimeout: boolean;
  negativeMarkingEnabled: boolean;
  /* Results & grading */
  passingScorePercent: number;
  gradingMode: string;
  showScoreToCandidate: boolean;
  sendResultEmail: boolean;
  includeAnswerReview: boolean;
  /* Internal */
  totalMarks: number;
  negativeMarking: number;
}

const CATEGORIES = [
  'Back-End Developer','Front-End Developer','Full-Stack Developer',
  'Data Analyst','Data Scientist','DevOps Engineer','Mobile Developer',
  'QA Engineer','Product Manager','UI/UX Designer',
];
const CUSTOM_CATEGORY_VALUE = '__custom_category__';
const LANGUAGES = ['English','Spanish','German','French','Portuguese','Hindi'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtForInput(iso?: string | null): string {
  if (!iso) return '';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function toISOStringFromLocalDateTime(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function settingsObject(t: Test): Record<string, unknown> {
  const ext = t as unknown as Record<string, unknown>;
  return ext.proctoringSettings && typeof ext.proctoringSettings === 'object' && !Array.isArray(ext.proctoringSettings)
    ? ext.proctoringSettings as Record<string, unknown>
    : {};
}

function settingValue(ext: Record<string, unknown>, settings: Record<string, unknown>, key: string): unknown {
  return ext[key] ?? settings[key];
}

function stringSetting(ext: Record<string, unknown>, settings: Record<string, unknown>, key: string, fallback: string): string {
  const value = settingValue(ext, settings, key);
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function booleanSetting(ext: Record<string, unknown>, settings: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = settingValue(ext, settings, key);
  return typeof value === 'boolean' ? value : fallback;
}

function toFormState(t: Test): FormState {
  const ext = t as unknown as Record<string, unknown>;
  const settings = settingsObject(t);
  const totalMarks = t.totalMarks ?? 100;
  const passingMarks = t.passingMarks ?? 40;
  return {
    name:               t.name ?? '',
    description:        t.description ?? '',
    category:           stringSetting(ext, settings, 'category', 'Back-End Developer'),
    language:           stringSetting(ext, settings, 'language', 'English'),
    duration:           t.duration ?? 60,
    startTime:          fmtForInput(t.startTime),
    endTime:            fmtForInput(t.endTime),
    requireInvitationLink: booleanSetting(ext, settings, 'requireInvitationLink', true),
    limitToOneAttempt:     !(t.allowMultipleAttempts ?? false),
    requireIdVerification: t.requireIdVerification ?? false,
    autoApproveId:         t.autoApproveId ?? false,
    idVerificationAutoApproveThreshold: t.idVerificationAutoApproveThreshold ?? 75,
    allowAccessCode:       booleanSetting(ext, settings, 'allowAccessCode', false),
    assessmentMode:        t.assessmentMode === 'NORMAL_BROWSER' ? 'NORMAL_BROWSER' : 'SEB',
    shuffleQuestions:      t.shuffleQuestions ?? false,
    shuffleOptions:        t.shuffleOptions ?? false,
    showTimer:             booleanSetting(ext, settings, 'showTimer', true),
    autoSubmitOnTimeout:   booleanSetting(ext, settings, 'autoSubmitOnTimeout', true),
    negativeMarkingEnabled:(t.negativeMarking ?? 0) > 0,
    passingScorePercent:   totalMarks > 0 ? Math.round((passingMarks / totalMarks) * 100) : 60,
    gradingMode:           stringSetting(ext, settings, 'gradingMode', 'Automatic'),
    showScoreToCandidate:  booleanSetting(ext, settings, 'showScoreToCandidate', false),
    sendResultEmail:       booleanSetting(ext, settings, 'sendResultEmail', false),
    includeAnswerReview:   booleanSetting(ext, settings, 'includeAnswerReview', false),
    totalMarks,
    negativeMarking:       t.negativeMarking ?? 0,
  };
}

/* -- Info tooltip -- */
function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ position:'relative', display:'inline-flex', verticalAlign:'middle' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="More information"
        style={{
          display:'flex', alignItems:'center', justifyContent:'center',
          width:'16px', height:'16px', borderRadius:'50%', border:'none',
          backgroundColor:'transparent', color:'var(--admin-text-subtle)',
          cursor:'pointer', padding:0, flexShrink:0,
        }}
      >
        <Info width={14} height={14} strokeWidth={1.75} />
      </button>
      {open && (
        <div style={{
          position:'absolute', top:'22px', left:0, zIndex:30, width:'280px',
          padding:'10px 12px', borderRadius:'8px', backgroundColor:'var(--admin-text)',
          color:'white', fontSize:'12px', lineHeight:1.5, boxShadow:'0 6px 20px rgba(0,0,0,0.2)',
        }}>
          {text}
        </div>
      )}
    </span>
  );
}

/* -- Toggle -- */
function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="admin-toggle"
      data-size="lg"
      data-state={on ? 'on' : 'off'}
      aria-pressed={on}
    >
      <span className="admin-toggle__knob" />
    </button>
  );
}

/* -- Toggle row -- */
function ToggleRow({ label, desc, on, onChange, last }: {
  label: string; desc: string; on: boolean; onChange: () => void; last?: boolean;
}) {
  return (
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'space-between', gap:'16px',
      padding:'18px 0', borderBottom: last ? 'none' : '1px solid var(--admin-border)',
    }}>
      <div>
        <p style={{ fontSize:'14px', fontWeight:500, color:'var(--admin-text)', margin:'0 0 3px' }}>{label}</p>
        <p style={{ fontSize:'12px', color:'var(--admin-text-subtle)', margin:0 }}>{desc}</p>
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}

/* -- shared input style -- */
const inputSx: React.CSSProperties = {
  width:'100%', padding:'10px 14px', borderRadius:'10px',
  border:'1.5px solid var(--admin-border)', backgroundColor:'white', color:'var(--admin-heading)',
  fontSize:'14px', outline:'none', fontFamily:'inherit', boxSizing:'border-box',
};
const labelSx: React.CSSProperties = {
  display:'block', fontSize:'13px', fontWeight:500, color:'var(--admin-text)', marginBottom:'6px',
};

export default function TestSettings() {
  const { testId }   = useParams();
  const navigate     = useNavigate();

  const [loading,           setLoading]           = useState(true);
  const [saving,            setSaving]             = useState(false);
  const [deleting,          setDeleting]           = useState(false);
  const [activePanel,       setActivePanel]        = useState<Panel>('general');
  const [original,          setOriginal]           = useState<FormState | null>(null);
  const [form,              setForm]               = useState<FormState | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm]  = useState(false);
  const [isCustomCategory,  setIsCustomCategory]   = useState(false);
  const [customCategoryOpen, setCustomCategoryOpen] = useState(false);
  const [customCategoryInput, setCustomCategoryInput] = useState('');
  const customCategoryInputRef = useRef<HTMLInputElement | null>(null);
  const emailBodyRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (customCategoryOpen) customCategoryInputRef.current?.focus();
  }, [customCategoryOpen]);

  // Email template state
  const [emailTab,          setEmailTab]           = useState<EmailTab>('invite');
  const [emailTemplates,    setEmailTemplates]     = useState<EmailTemplates | null>(null);
  const [emailEditing,      setEmailEditing]       = useState<EmailTab | null>(null);
  const [emailEditingMode,  setEmailEditingMode]   = useState<'SEB' | 'NORMAL_BROWSER'>('SEB');
  const [emailDraft,        setEmailDraft]         = useState<{ subject: string; body: string }>({ subject: '', body: '' });
  const [emailSaving,       setEmailSaving]        = useState(false);
  const [reminderHoursDraft, setReminderHoursDraft] = useState<number>(24);
  const [reminderHoursSaving, setReminderHoursSaving] = useState(false);
  useEffect(() => { if (testId) void load(); }, [testId]);

  const load = async () => {
    setLoading(true);
    try {
      const [testRes, emailRes] = await Promise.all([
        adminApi.getTest(testId!),
        adminApi.getEmailTemplates(testId!),
      ]);
      const fs = toFormState(testRes.data.test as Test);
      const loadedCategoryIsCustom = !CATEGORIES.includes(fs.category);
      setOriginal(fs); setForm(fs);
      setIsCustomCategory(loadedCategoryIsCustom);
      setCustomCategoryOpen(false);
      setCustomCategoryInput(loadedCategoryIsCustom ? fs.category : '');
      const templates = emailRes.data as EmailTemplates;
      setEmailTemplates(templates);
      setReminderHoursDraft(templates.reminderHoursBeforeClose);
    } catch { toast.error('Failed to load settings'); }
    finally { setLoading(false); }
  };
  
const insertEmailToken = (token: string) => {
  const textarea = emailBodyRef.current;

  if (!textarea) {
    setEmailDraft(d => ({
      ...d,
      body: d.body + token,
    }));
    return;
  }

  const start = textarea.selectionStart ?? emailDraft.body.length;
  const end = textarea.selectionEnd ?? start;

  setEmailDraft(d => {
    const body = d.body;
    return {
      ...d,
      body: `${body.slice(0, start)}${token}${body.slice(end)}`,
    };
  });

  requestAnimationFrame(() => {
    const position = start + token.length;
    textarea.focus();
    textarea.setSelectionRange(position, position);
  });
};


  const openEmailEdit = (tab: EmailTab) => {
    if (!emailTemplates || !form) return;
    const activeTemplates = emailTemplates.templates[form.assessmentMode];
    setEmailDraft(
      tab === 'invite'
        ? { subject: activeTemplates.inviteEmailSubject, body: activeTemplates.inviteEmailBody }
        : tab === 'reminder'
          ? { subject: activeTemplates.reminderEmailSubject, body: activeTemplates.reminderEmailBody }
          : { subject: activeTemplates.confirmEmailSubject, body: activeTemplates.confirmEmailBody }
    );
    setEmailEditingMode(form.assessmentMode);
    setEmailEditing(tab);
  };

  const handleEmailSave = async () => {
    if (!testId || !emailEditing || !emailTemplates) return;
    setEmailSaving(true);
    try {
      const patch = emailEditing === 'invite'
        ? { inviteEmailSubject: emailDraft.subject, inviteEmailBody: emailDraft.body }
        : emailEditing === 'reminder'
          ? { reminderEmailSubject: emailDraft.subject, reminderEmailBody: emailDraft.body }
          : { confirmEmailSubject: emailDraft.subject, confirmEmailBody: emailDraft.body };
      await adminApi.updateEmailTemplates(testId, { ...patch, templateMode: emailEditingMode });
      setEmailTemplates(prev => prev ? {
        ...prev,
        templates: {
          ...prev.templates,
          [emailEditingMode]: { ...prev.templates[emailEditingMode], ...patch },
        },
      } : prev);
      setEmailEditing(null);
      toast.success('Email template saved');
    } catch { toast.error('Failed to save email template'); }
    finally { setEmailSaving(false); }
  };

  const handleReminderHoursSave = async () => {
    if (!testId || !emailTemplates) return;
    setReminderHoursSaving(true);
    try {
      await adminApi.updateEmailTemplates(testId, { reminderHoursBeforeClose: reminderHoursDraft });
      setEmailTemplates(prev => prev ? { ...prev, reminderHoursBeforeClose: reminderHoursDraft } : prev);
      toast.success('Reminder timing saved');
    } catch { toast.error('Failed to save reminder timing'); }
    finally { setReminderHoursSaving(false); }
  };

  const patch = (p: Partial<FormState>) => setForm(prev => prev ? { ...prev, ...p } : prev);

  const categorySelectValue = isCustomCategory && customCategoryOpen
    ? CUSTOM_CATEGORY_VALUE
    : form?.category ?? CUSTOM_CATEGORY_VALUE;
  const categorySelectOptions = [
    ...CATEGORIES.map(category => ({ value: category, label: category })),
    ...(isCustomCategory && customCategoryInput.trim()
      ? [{ value: customCategoryInput.trim(), label: customCategoryInput.trim() }]
      : []),
    { value: CUSTOM_CATEGORY_VALUE, label: 'Custom' },
  ];

  const handleSave = async () => {
    if (!testId || !form) return;
    setSaving(true);
    try {
      await adminApi.updateTest(testId, {
        name: form.name, description: form.description,
        category: form.category, language: form.language,
        duration: form.duration,
        startTime: toISOStringFromLocalDateTime(form.startTime),
        endTime:   toISOStringFromLocalDateTime(form.endTime),
        requireInvitationLink: form.requireInvitationLink,
        allowMultipleAttempts: !form.limitToOneAttempt,
        requireIdVerification: form.requireIdVerification,
        autoApproveId:         form.autoApproveId,
        idVerificationAutoApproveThreshold: form.idVerificationAutoApproveThreshold,
        allowAccessCode:       form.allowAccessCode,
        assessmentMode:        form.assessmentMode,
        shuffleQuestions:      form.shuffleQuestions,
        shuffleOptions:        form.shuffleOptions,
        showTimer:             form.showTimer,
        autoSubmitOnTimeout:   form.autoSubmitOnTimeout,
        negativeMarking:       form.negativeMarkingEnabled ? 0.25 : 0,
        passingMarks: form.totalMarks > 0
          ? Math.round((form.passingScorePercent / 100) * form.totalMarks)
          : form.passingScorePercent,
        gradingMode:          form.gradingMode,
        showScoreToCandidate: form.showScoreToCandidate,
        sendResultEmail:      form.sendResultEmail,
        includeAnswerReview:  form.includeAnswerReview,
      });
      setOriginal(form);
      toast.success('Settings saved');
    } catch { toast.error('Failed to save settings'); }
    finally { setSaving(false); }
  };

  const handleDiscard = () => {
    if (original) { setForm(original); toast('Changes discarded', { icon: '?' }); }
  };

  const handleDeleteTest = async () => {
    if (!testId) return;
    setDeleting(true);
    try {
      await adminApi.deleteTest(testId);
      toast.success('Test deleted');
      navigate('/admin/tests');
    } catch { toast.error('Failed to delete test'); setDeleting(false); }
  };

  if (loading) return (
    <div style={{ display:'flex', justifyContent:'center', padding:'80px 0' }}>
      <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor:'var(--admin-accent)' }} />
    </div>
  );
  if (!form) return null;

  const PANELS: { id: Panel; label: string }[] = [
    { id:'general',  label:'General' },
    { id:'access',   label:'Access & scheduling' },
    { id:'assessmentmode',   label:'Mode of Assessment' },
    { id:'behavior', label:'Test behavior' },
    { id:'grading',  label:'Results & grading' },
    { id:'email',    label:'Email' },
    { id:'danger',   label:'Danger zone' },
  ];

  /* -- danger zone action row -- */
  const DangerRow = ({ label, desc, btnLabel, btnRed, onClick, last }: {
    label: string; desc: string; btnLabel: string; btnRed?: boolean; onClick: () => void; last?: boolean;
  }) => (
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'space-between', gap:'16px',
      padding:'16px 18px', marginBottom: last ? 0 : '12px',
      borderRadius:'10px', border:'1px solid rgba(239, 68, 68, 0.25)', backgroundColor:'rgba(239, 68, 68, 0.06)',
    }}>
      <div>
        <p style={{ fontSize:'14px', fontWeight:500, color:'var(--admin-text)', margin:'0 0 3px' }}>{label}</p>
        <p style={{ fontSize:'12px', color:'var(--admin-text-subtle)', margin:0 }}>{desc}</p>
      </div>
      <button type="button" onClick={onClick}
        className={btnRed ? 'btn btn-danger' : 'btn btn-secondary'}
        style={{
          fontSize:'13px', whiteSpace:'nowrap',
        }}>
        {btnLabel}
      </button>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'500px' }}>

      {/* -- MAIN GRID -- */}
      <div style={{ display:'grid', gridTemplateColumns:'220px 1fr', gap:'0', flex:1 }}>

        {/* LEFT SIDEBAR */}
        <div style={{ paddingTop:'4px', paddingRight:'8px' }}>
          {PANELS.map(p => {
            const active = activePanel === p.id;
            const isDanger = p.id === 'danger';
            return (
              <button key={p.id} type="button" onClick={() => setActivePanel(p.id)}
                style={{
                  display:'flex', alignItems:'center', justifyContent:'space-between',
                  width:'100%', padding:'10px 14px', borderRadius:'10px',
                  border:'none', cursor:'pointer', marginBottom:'2px',
                  backgroundColor: active ? 'var(--admin-accent)' : 'transparent',
                  color: active ? 'white' : 'var(--admin-text)',
                  fontSize:'14px', fontWeight: active ? 600 : 400,
                  textAlign:'left', transition:'background-color 0.15s',
                }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--admin-accent-soft)'; }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                <span>{p.label}</span>
                {active && <ChevronRight size={14} color="white" />}
              </button>
            );
          })}
        </div>

        {/* RIGHT CONTENT CARD */}
        <div style={{ paddingLeft:'8px', paddingBottom:'24px' }}>
          <div style={{
            backgroundColor:'white', borderRadius:'var(--admin-card-radius)',
            boxShadow:'var(--admin-card-shadow)', border:'1px solid var(--admin-border)', padding:'28px 32px',
          }}>

            {/* --- GENERAL --- */}
            {activePanel === 'general' && (
              <div style={{ display:'flex', flexDirection:'column', gap:'20px' }}>
                <p style={{ fontSize:'18px', fontWeight:700, color:'var(--admin-text)', margin:0 }}>General</p>

                <div>
                  <label style={labelSx}>Test title</label>
                  <input type="text" value={form.name}
                    onChange={e => patch({ name: e.target.value })} style={inputSx} />
                </div>

                <div>
                  <label style={labelSx}>Description</label>
                  <textarea value={form.description}
                    onChange={e => patch({ description: e.target.value })}
                    rows={4} style={{ ...inputSx, lineHeight:'1.5' }} />
                </div>

                <div>
                  <label style={labelSx}> Duration (minutes)</label>
                  <input type="number" min={1}
                    value={form.duration}
                    onChange={e => {
                      const parsed = Math.round(Number(e.target.value));
                      patch({ duration: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 });
                    }}
                    onBlur={() => patch({ duration: Math.max(1, form.duration) })}
                    style={{ ...inputSx, width:'160px' }} />
                  <p style={{ fontSize:'11px', color:'var(--admin-text-subtle)', margin:'6px 0 0' }}>
                    Total time each candidate gets to complete this test, once started.
                  </p>
                </div>

                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
                  {/* Category custom dropdown */}
                  <div>
                    <label style={labelSx}>Category</label>
                    <CustomSelect
                      value={categorySelectValue}
                      onChange={category => {
                        if (category === CUSTOM_CATEGORY_VALUE) {
                          setIsCustomCategory(true);
                          setCustomCategoryOpen(true);
                          setCustomCategoryInput('');
                          patch({ category: '' });
                          return;
                        }
                        const isPreset = CATEGORIES.includes(category);
                        if (!isPreset && isCustomCategory) {
                          // Re-opened their own already-typed custom entry — let them edit it, not re-pick it.
                          setCustomCategoryOpen(true);
                          return;
                        }
                        setIsCustomCategory(false);
                        setCustomCategoryOpen(false);
                        setCustomCategoryInput('');
                        patch({ category });
                      }}
                      options={categorySelectOptions}
                      style={{ width:'100%', minWidth:0 }}
                    />
                    {isCustomCategory && customCategoryOpen && (
                      <input
                        ref={customCategoryInputRef}
                        type="text"
                        value={customCategoryInput}
                        onChange={e => {
                          const category = e.target.value;
                          setCustomCategoryInput(category);
                          patch({ category });
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (customCategoryInput.trim()) setCustomCategoryOpen(false);
                          }
                        }}
                        placeholder="Type custom role/category, then press Enter"
                        style={{ ...inputSx, marginTop: '8px' }}
                      />
                    )}
                  </div>
                  {/* Language custom dropdown */}
                  <div>
                    <label style={labelSx}>Language</label>
                    <CustomSelect
                      value={form.language}
                      onChange={language => patch({ language })}
                      options={LANGUAGES.map(language => ({ value: language, label: language }))}
                      style={{ width:'100%', minWidth:0 }}
                    />
                  </div>
                </div>
              </div>
            )}
            

            {/* --- ACCESS & SCHEDULING --- */}
            {activePanel === 'access' && (
              <div>
                <p style={{ fontSize:'18px', fontWeight:700, color:'var(--admin-text)', margin:'0 0 24px' }}>
                  Access &amp; scheduling
                </p>

                {/* Opens / Closes */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px', marginBottom:'4px' }}>
                  <div>
                    <label style={labelSx}>Opens</label>
                    <DateTimePicker value={form.startTime} onChange={v => patch({ startTime: v })} placeholder="Select open date & time" />
                  </div>
                  <div>
                    <label style={labelSx}>Closes</label>
                    <DateTimePicker value={form.endTime} onChange={v => patch({ endTime: v })} minDateTime={form.startTime} placeholder="Select close date & time" />
                  </div>
                </div>

                <ToggleRow label="Require invitation link"    desc="Only invited emails can start"          on={form.requireInvitationLink} onChange={() => patch({ requireInvitationLink: !form.requireInvitationLink })} />
                <ToggleRow label="Limit to one attempt"       desc="Candidate can take the test once"       on={form.limitToOneAttempt}     onChange={() => patch({ limitToOneAttempt: !form.limitToOneAttempt })} />
                <ToggleRow label="Require ID verification"    desc="Photo ID check before start"            on={form.requireIdVerification} onChange={() => patch({ requireIdVerification: !form.requireIdVerification })} />

                {form.requireIdVerification && (
                  <div style={{
                    margin:'-4px 0 18px', padding:'16px', backgroundColor:'#F9FAFB',
                    borderRadius:'10px', border:'1px solid var(--admin-border)',
                  }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'16px' }}>
                      <div>
                        <p style={{ fontSize:'14px', fontWeight:500, color:'var(--admin-text)', margin:'0 0 3px' }}>Auto approve ID</p>
                        <p style={{ fontSize:'12px', color:'var(--admin-text-subtle)', margin:0 }}>Skip the admin queue when face match is confident enough</p>
                      </div>
                      <Toggle on={form.autoApproveId} onChange={() => patch({ autoApproveId: !form.autoApproveId })} />
                    </div>

                    <div style={{ marginTop:'14px' }}>
                      <label style={labelSx}>Auto-approve threshold (% face match)</label>
                      <input
                        type="number" min={0} max={100}
                        value={form.idVerificationAutoApproveThreshold}
                        onChange={e => patch({ idVerificationAutoApproveThreshold: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                        disabled={!form.autoApproveId}
                        style={{ ...inputSx, width:'140px', opacity: form.autoApproveId ? 1 : 0.5 }}
                      />
                      <p style={{ fontSize:'11px', color:'var(--admin-text-subtle)', margin:'6px 0 0' }}>
                        Candidates scoring at or above this face-match score are verified automatically. Only takes effect when Auto approve ID is on.
                      </p>
                    </div>
                  </div>
                )}

                <ToggleRow label="Allow access code"          desc="Candidates enter a code to join"        on={form.allowAccessCode}       onChange={() => patch({ allowAccessCode: !form.allowAccessCode })} last />
              </div>
            )}


            {/* --- MODE OF ASSESSMENT --- */}
{activePanel === 'assessmentmode' && (
  <div>
    <p
      style={{
        fontSize: '18px',
        fontWeight: 700,
        color: 'var(--admin-text)',
        margin: '0 0 4px',
      }}
    >
      Mode of assessment
    </p>

    <p
      style={{
        fontSize: '13px',
        color: 'var(--admin-text-muted)',
        margin: '0 0 24px',
      }}
    >
      Choose how candidates will access this assessment.
    </p>

    <div
      style={{
        padding: '16px 18px',
        border: '1px solid var(--admin-border)',
        borderRadius: '10px',
        backgroundColor: '#F9FAFB',
      }}
    >
      <label
        style={{
          display: 'block',
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--admin-text-muted)',
          marginBottom: '8px',
        }}
      >
        Assessment mode
      </label>

      <CustomSelect
        value={form.assessmentMode}
        onChange={(value) => {
          patch({ assessmentMode: value as 'SEB' | 'NORMAL_BROWSER' });
          setEmailEditing(null);
        }}
        options={[
          {
            value: 'SEB',
            label: 'Safe Exam Browser',
          },
          {
            value: 'NORMAL_BROWSER',
            label: 'Normal Browser',
          },
        ]}
        style={{
          width: '100%',
          maxWidth: '420px',
        }}
      />

      <p
        style={{
          fontSize: '11px',
          color: 'var(--admin-text-subtle)',
          margin: '8px 0 0',
        }}
      >
        Safe Exam Browser is selected by default.
      </p>
    </div>
  </div>
)}


            {/* --- TEST BEHAVIOR --- */}
            {activePanel === 'behavior' && (
              <div>
                <p style={{ fontSize:'18px', fontWeight:700, color:'var(--admin-text)', margin:'0 0 4px' }}>Test behavior</p>

                <ToggleRow label="Randomize question order"  desc="Shuffle per candidate"               on={form.shuffleQuestions}       onChange={() => patch({ shuffleQuestions: !form.shuffleQuestions })} />
                <ToggleRow label="Randomize answer options"  desc="Shuffle MCQ choices"                 on={form.shuffleOptions}         onChange={() => patch({ shuffleOptions: !form.shuffleOptions })} />
                <ToggleRow label="Show timer"                desc="Visible countdown"                   on={form.showTimer}              onChange={() => patch({ showTimer: !form.showTimer })} />
                <ToggleRow label="Auto-submit on timeout"    desc="Submit when time ends"               on={form.autoSubmitOnTimeout}    onChange={() => patch({ autoSubmitOnTimeout: !form.autoSubmitOnTimeout })} />
                <ToggleRow label="Negative marking"          desc="Deduct points for wrong answers"     on={form.negativeMarkingEnabled} onChange={() => patch({ negativeMarkingEnabled: !form.negativeMarkingEnabled })} last />
              </div>
            )}

            {/* --- RESULTS & GRADING --- */}
            {activePanel === 'grading' && (
              <div>
                <p style={{ fontSize:'18px', fontWeight:700, color:'var(--admin-text)', margin:'0 0 24px', display:'flex', alignItems:'center', gap:'8px' }}>
                  Results &amp; grading
                  <InfoTooltip text="Automatic grading releases each candidate's result the instant they submit. Manual grading holds results until you click 'Release results' on their attempt page. 'Show score to candidate' reveals their score/pass-fail once released. 'Send result email' emails them their outcome once released — you can also send it manually any time from an attempt's page." />
                </p>

                {/* Passing score + Grading mode */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px', marginBottom:'8px' }}>
                  <div>
                    <label style={labelSx}>Passing score (%)</label>
                    <input type="number" min={0} max={100} value={form.passingScorePercent}
                      onChange={e => patch({ passingScorePercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                      style={inputSx} />
                  </div>
                  <div>
                    <label style={labelSx}>Grading mode</label>
                    <CustomSelect
                      value={form.gradingMode}
                      onChange={v => patch({ gradingMode: v })}
                      options={[{ value:'Automatic', label:'Automatic' }, { value:'Manual', label:'Manual' }]}
                      style={{ width:'100%' }}
                    />
                  </div>
                </div>

                <ToggleRow label="Show score to candidate" desc="Reveal result after submit"         on={form.showScoreToCandidate} onChange={() => patch({ showScoreToCandidate: !form.showScoreToCandidate })} />
                <ToggleRow label="Send result email"       desc="Email candidate their outcome"      on={form.sendResultEmail}      onChange={() => patch({ sendResultEmail: !form.sendResultEmail })} />
                <ToggleRow label="Include answer review"   desc="Show correct answers"               on={form.includeAnswerReview}  onChange={() => patch({ includeAnswerReview: !form.includeAnswerReview })} last />
              </div>
            )}

            {/* --- EMAIL --- */}
            {activePanel === 'email' && (
              <div>
                <p style={{ fontSize:'18px', fontWeight:700, color:'var(--admin-text)', margin:'0 0 4px' }}>Email Insights</p>
                <p style={{ fontSize:'13px', color:'var(--admin-text-muted)', margin:'0 0 20px' }}>
                  Customize the emails sent to candidates during the assessment lifecycle.
                </p>
                <div style={{ marginBottom:'16px', padding:'10px 12px', borderRadius:'9px', backgroundColor:'var(--admin-accent-soft)', color:'var(--admin-accent-hover)', fontSize:'12px', fontWeight:600 }}>
                  Editing {form.assessmentMode === 'SEB' ? 'Safe Exam Browser' : 'Normal Browser'} email templates. Changing the assessment mode automatically switches this template set.
                </div>

                {/* Tabs */}
                <div style={{ display:'flex', borderBottom:'2px solid var(--admin-border)', marginBottom:'24px' }}>
                  {(['invite','confirm','reminder'] as EmailTab[]).map(tab => (
                    <button key={tab} type="button"
                      onClick={() => setEmailTab(tab)}
                      style={{
                        padding:'8px 18px', border:'none', background:'none', cursor:'pointer',
                        fontSize:'13px', fontWeight: emailTab === tab ? 600 : 400,
                        color: emailTab === tab ? 'var(--admin-accent)' : 'var(--admin-text-muted)',
                        borderBottom: emailTab === tab ? '2px solid var(--admin-accent)' : '2px solid transparent',
                        marginBottom:'-2px', transition:'color 0.15s',
                      }}>
                      {EMAIL_TAB_LABELS[tab]}
                    </button>
                  ))}
                </div>

                {emailTemplates && (() => {
                  const activeTemplates = emailTemplates.templates[form.assessmentMode];
                  const isInvite = emailTab === 'invite';
                  const isReminder = emailTab === 'reminder';
                  const subject = isInvite ? activeTemplates.inviteEmailSubject
                    : isReminder ? activeTemplates.reminderEmailSubject
                    : activeTemplates.confirmEmailSubject;
                  const body = isInvite ? activeTemplates.inviteEmailBody
                    : isReminder ? activeTemplates.reminderEmailBody
                    : activeTemplates.confirmEmailBody;
                  const editKey = emailTab;
                  const isVarApplicable = (key: string) => {
                    if (INVITE_ONLY_VAR_KEYS.has(key)) return isInvite;
                    if (REMINDER_ONLY_VAR_KEYS.has(key)) return isReminder;
                    if (INVITE_AND_REMINDER_VAR_KEYS.has(key)) return isInvite || isReminder;
                    if (SEB_BUTTON_VAR_KEYS.has(key)) return form.assessmentMode === 'SEB' && (isInvite || isReminder);
                    return true;
                  };
                  return (
                    <div>
                      {/* Description */}
                      <p style={{ fontSize:'12px', color:'var(--admin-text-subtle)', margin:'0 0 16px' }}>
                        {EMAIL_TAB_DESCRIPTIONS[emailTab]}
                      </p>

                      {isReminder && (
                        <div style={{
                          display:'flex', alignItems:'center', gap:'10px', marginBottom:'20px',
                          padding:'12px 16px', backgroundColor:'#F9FAFB', borderRadius:'10px',
                          border:'1px solid var(--admin-border)', flexWrap:'wrap',
                        }}>
                          <label style={{ fontSize:'12px', fontWeight:600, color:'var(--admin-text-muted)', display:'flex', alignItems:'center', gap:'5px', whiteSpace:'nowrap' }}>
                            Send reminder
                            <span
                              title="How many hours before the test's access window closes we'll email candidates who haven't started yet. Only applies to tests with a fixed end date/time — open-ended tests never trigger this reminder."
                              style={{ display:'inline-flex', cursor:'help', color:'var(--admin-text-subtle)' }}
                            >
                              <Info size={13} />
                            </span>
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={reminderHoursDraft}
                            onChange={e => setReminderHoursDraft(Math.max(1, Math.round(Number(e.target.value)) || 1))}
                            className="input"
                            style={{ width:'70px', fontSize:'13px', padding:'6px 8px' }}
                          />
                          <span style={{ fontSize:'12px', color:'var(--admin-text-muted)' }}>hours before the test closes</span>
                          {reminderHoursDraft !== emailTemplates.reminderHoursBeforeClose && (
                            <button type="button"
                              onClick={handleReminderHoursSave}
                              disabled={reminderHoursSaving}
                              className="btn btn-primary"
                              style={{ marginLeft:'auto', padding:'4px 14px', fontSize:'12px' }}>
                              {reminderHoursSaving ? 'Saving…' : 'Save'}
                            </button>
                          )}
                        </div>
                      )}

                      {emailEditing === editKey ? (
                        /* -- Edit mode -- */
                        <div>
                          <div style={{ marginBottom:'14px' }}>
                            <label style={{ display:'block', fontSize:'12px', fontWeight:600, color:'var(--admin-text-muted)', marginBottom:'6px' }}>Subject</label>
                            <input type="text"
                              value={emailDraft.subject}
                              onChange={e => setEmailDraft(d => ({ ...d, subject: e.target.value }))}
                              className="input"
                              style={{ fontSize:'13px' }}
                            />
                          </div>

                          <div style={{ marginBottom:'14px' }}>
                            <label style={{ display:'block', fontSize:'12px', fontWeight:600, color:'var(--admin-text-muted)', marginBottom:'6px' }}>Body</label>
                            <textarea
                            ref={emailBodyRef}
                              value={emailDraft.body}
                              onChange={e => setEmailDraft(d => ({ ...d, body: e.target.value }))}
                              rows={12}
                              className="input"
                              style={{ fontSize:'13px', fontFamily:'inherit', lineHeight:'1.7', maxHeight:'480px' }}
                            />
                          </div>

                          <div style={{ marginBottom:'16px' }}>
                            <p style={{ fontSize:'11px', fontWeight:600, color:'var(--admin-text-subtle)', margin:'0 0 8px', textTransform:'uppercase', letterSpacing:'0.05em' }}>
                              Click a variable to insert it
                            </p>
                            <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
                              {AVAILABLE_VARS.filter(v => isVarApplicable(v.key)).map(v => (
                                <button key={v.key} type="button" title={v.desc}
                                  onClick={() => insertEmailToken(v.key)}
                                  style={{
                                    fontSize:'11px', fontWeight:600, color:'var(--admin-accent-hover)',
                                    backgroundColor:'var(--admin-accent-disabled)', padding:'2px 8px', borderRadius:'20px',
                                    border:'none', cursor:'pointer',
                                  }}>{v.key}</button>
                              ))}
                            </div>
                          </div>

                          <div style={{ display:'flex', justifyContent:'flex-end', gap:'10px' }}>
                            <button type="button"
                              onClick={() => setEmailEditing(null)}
                              disabled={emailSaving}
                              className="btn btn-secondary">Cancel</button>
                            <button type="button"
                              onClick={handleEmailSave}
                              disabled={emailSaving}
                              className="btn btn-primary">
                              {emailSaving ? 'Saving…' : 'Save Changes'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* -- Preview mode -- */
                        <div>
                          <div style={{ marginBottom:'16px', backgroundColor:'#F9FAFB', borderRadius:'10px', padding:'12px 16px', border:'1px solid var(--admin-border)' }}>
                            <p style={{ fontSize:'11px', fontWeight:600, color:'var(--admin-text-subtle)', margin:'0 0 4px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Subject</p>
                            <p style={{ fontSize:'13px', color:'var(--admin-text-muted)', margin:0 }}>{subject}</p>
                          </div>

                          <div style={{ backgroundColor:'#F9FAFB', borderRadius:'10px', padding:'16px', border:'1px solid var(--admin-border)', marginBottom:'16px' }}>
                            <p style={{ fontSize:'11px', fontWeight:600, color:'var(--admin-text-subtle)', margin:'0 0 10px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Body</p>
                            <pre style={{ fontSize:'13px', color:'var(--admin-text-muted)', margin:0, whiteSpace:'pre-wrap', fontFamily:'inherit', lineHeight:'1.7' }}>
                              {body}
                            </pre>
                          </div>

                          <div style={{ marginBottom:'16px' }}>
                            <p style={{ fontSize:'11px', fontWeight:600, color:'var(--admin-text-subtle)', margin:'0 0 8px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Available variables</p>
                            <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
                              {AVAILABLE_VARS.filter(v => isVarApplicable(v.key)).map(v => (
                                <span key={v.key} title={v.desc} style={{
                                  fontSize:'11px', fontWeight:600, color:'var(--admin-accent-hover)',
                                  backgroundColor:'var(--admin-accent-disabled)', padding:'2px 8px', borderRadius:'20px',
                                  cursor:'default',
                                }}>{v.key}</span>
                              ))}
                            </div>
                          </div>

                          <div style={{ display:'flex', justifyContent:'flex-end', gap:'10px' }}>
                            <button type="button"
                              onClick={() => openEmailEdit(editKey)}
                              className="btn btn-secondary">
                              <Pencil size={13} />
                              Edit {EMAIL_TAB_LABELS[emailTab]}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {!emailTemplates && (
                  <div style={{ display:'flex', justifyContent:'center', padding:'40px 0' }}>
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor:'var(--admin-accent)' }} />
                  </div>
                )}
              </div>
            )}

            {/* --- DANGER ZONE --- */}
            {activePanel === 'danger' && (
              <div>
                <p style={{ fontSize:'18px', fontWeight:700, color:'#EF4444', margin:'0 0 4px' }}>Danger zone</p>
                <p style={{ fontSize:'13px', color:'var(--admin-text-muted)', margin:'0 0 8px' }}>These actions are irreversible.</p>

                <DangerRow
                  label="Delete test"    desc="Permanently remove test & attempts"
                  btnLabel="Delete"     btnRed
                  onClick={() => setShowDeleteConfirm(true)}
                  last
                />
              </div>
            )}

          </div>{/* end white card */}
        </div>
      </div>

      {/* -- BOTTOM BAR -- */}
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'flex-end', gap:'12px',
        padding:'16px 0 4px',
        borderTop:'1px solid var(--admin-border)',
        marginTop:'16px',
      }}>
        <button type="button" onClick={handleDiscard} className="btn btn-secondary">
          Discard
        </button>
        <button type="button" onClick={handleSave} disabled={saving}
          className="btn btn-primary">
          {!saving && <Check size={14} color="white" />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {/* -- DELETE CONFIRM MODAL -- */}
      {showDeleteConfirm && (
        <div style={{
          position:'fixed', inset:0, zIndex:50,
          display:'flex', alignItems:'center', justifyContent:'center',
          backgroundColor:'rgba(0,0,0,0.45)',
        }}>
          <div style={{
            backgroundColor:'white', borderRadius:'16px', padding:'28px',
            width:'100%', maxWidth:'420px', boxShadow:'0 20px 60px rgba(0,0,0,0.2)',
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'12px' }}>
              <div style={{
                width:'40px', height:'40px', borderRadius:'50%',
                backgroundColor:'#FEE2E2', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
              }}>
                <Trash2 size={18} color="#DC2626" />
              </div>
              <p style={{ fontSize:'16px', fontWeight:700, color:'var(--admin-text)', margin:0 }}>Delete test?</p>
            </div>
            <p style={{ fontSize:'14px', color:'var(--admin-text-muted)', margin:'0 0 24px', lineHeight:'1.6' }}>
              This will permanently delete the test and all candidate attempts, results, and invitations.
              This action <strong style={{ color:'var(--admin-text-muted)' }}>cannot be undone</strong>.
            </p>
            <div style={{ display:'flex', gap:'10px' }}>
              <button type="button" onClick={() => setShowDeleteConfirm(false)}
                className="btn btn-secondary"
                style={{ flex:1 }}>
                Cancel
              </button>
              <button type="button" onClick={handleDeleteTest} disabled={deleting}
                className="btn btn-danger"
                style={{ flex:1 }}>
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
