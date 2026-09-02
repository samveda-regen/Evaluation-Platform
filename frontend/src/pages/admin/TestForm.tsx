import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { format } from 'date-fns';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardCheck,
  FileText,
  ListChecks,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { adminApi } from '../../services/api';
import DateTimePicker from '../../components/DateTimePicker';
import BackButton from '../../components/BackButton';
import CustomSelect from '../../components/CustomSelect';

function calculateDurationMinutes(startTime: string, endTime: string): number | null {
  if (!startTime || !endTime) return null;
  const startDate = new Date(startTime);
  const endDate = new Date(endTime);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  const diffMs = endDate.getTime() - startDate.getTime();
  if (diffMs <= 0) return null;
  return Math.ceil(diffMs / (60 * 1000));
}

function toISOStringFromLocalDateTime(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function addMinutesToLocalDateTime(value: string, minutes: number): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  parsed.setMinutes(parsed.getMinutes() + minutes);
  return format(parsed, "yyyy-MM-dd'T'HH:mm");
}

function marksToPercent(passingMarks: number | null | undefined, totalMarks: number): number {
  if (passingMarks == null) return 0;
  return totalMarks > 0 ? Math.round((passingMarks / totalMarks) * 100) : passingMarks;
}

function percentToMarks(passingScorePercent: number, totalMarks: number): number {
  return totalMarks > 0 ? Math.round((passingScorePercent / 100) * totalMarks) : passingScorePercent;
}

function CheckOption({ name, checked, onChange, label, disabled }: {
  name: string;
  checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700" style={{ opacity: disabled ? 0.5 : 1 }}>
      <div className="admin-square-toggle" data-state={checked ? 'on' : 'off'} style={{ pointerEvents: disabled ? 'none' : 'auto' }}>
        {checked && <Check width={10} height={10} stroke="white" strokeWidth={2} />}
      </div>
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
      />
      <span>{label}</span>
    </label>
  );
}

function SourceRow({ icon, label, checked, onChange }: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label onClick={onChange} className="flex items-center gap-3 px-1 py-3 cursor-pointer border-b border-gray-100 last:border-0">
      <div className="admin-square-toggle" data-state={checked ? 'on' : 'off'}>
        {checked && <Check width={10} height={10} stroke="white" strokeWidth={2} />}
      </div>
      {icon}
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: '10px',
  border: '1.5px solid var(--admin-border)',
  fontSize: '13px',
  color: 'var(--admin-text)',
  outline: 'none',
  boxSizing: 'border-box',
  backgroundColor: 'white',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--admin-text-muted)',
  marginBottom: '7px',
};

const WIZARD_STEPS = [
  { label: 'Test Details', icon: FileText },
  { label: 'Format', icon: ListChecks },
  { label: 'Security', icon: ShieldCheck },
  { label: 'Review', icon: ClipboardCheck },
];

const CUSTOM_CATEGORY_VALUE = '__custom_category__';
const MAX_TEST_VIOLATIONS = 150;
const ROLE_CATEGORY_OPTIONS = [
  { value: 'back-end', label: 'Back-End Developer' },
  { value: 'front-end', label: 'Front-End Developer' },
  { value: 'full-stack', label: 'Full Stack Developer' },
  { value: 'devops', label: 'DevOps Engineer' },
  { value: 'data', label: 'Data Scientist' },
];

function FormGroupTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-4">
      <p className="text-sm font-semibold text-gray-800">{children}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function StepIndicator({ current }: { current: number }) {
  return (
    <nav className="flex items-center mb-8">
      {WIZARD_STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const Icon = step.icon;
        return (
          <div key={step.label} className="contents">
            <div className="flex items-center gap-2">
              <div
                className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold"
                style={{
                  backgroundColor: done || active ? 'var(--admin-accent)' : '#F3F4F6',
                  color: done || active ? 'white' : '#9CA3AF',
                  boxShadow: active ? '0 0 0 4px var(--admin-focus-ring)' : 'none',
                }}
              >
                {done ? (
                  <Check width={15} height={15} strokeWidth={2.3} />
                ) : (
                  <Icon width={15} height={15} strokeWidth={2.1} />
                )}
              </div>
              <span
                className={`text-sm font-medium hidden sm:block ${
                  active ? 'text-gray-900' : done ? 'text-gray-500' : 'text-gray-400'
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < WIZARD_STEPS.length - 1 && (
              <div
                className="flex-1 h-px mx-3"
                style={{ backgroundColor: i < current ? 'var(--admin-accent)' : '#E5E7EB' }}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}

export default function TestForm() {
  const { testId } = useParams();
  const navigate = useNavigate();
  const isEditing = !!testId;
  const scrollCardRef = useRef<HTMLDivElement | null>(null);

  const [step, setStep] = useState(0);
  const [titleError, setTitleError] = useState(false);
  const [loading, setLoading] = useState(false);
  // Only known once an existing test is loaded for editing — a brand-new test (tests/new)
  // hasn't had its assessment mode chosen yet (that happens later, on the separate
  // TestSettings page), so this stays null during creation and the checkbox below just
  // shows normally in that case. SEB's own kiosk lockdown already covers most of what
  // screen share would catch, and getDisplayMedia() is unsupported on some SEB Mac
  // versions regardless of any .seb config -- confirmed against a real candidate machine.
  const [testAssessmentMode, setTestAssessmentMode] = useState<'SEB' | 'NORMAL_BROWSER' | null>(null);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard' | 'mixed'>('mixed');
  const [srcs, setSrcs] = useState({ library: true, write: true });
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [customCategoryOpen, setCustomCategoryOpen] = useState(false);
  const [customCategoryInput, setCustomCategoryInput] = useState('');
  const customCategoryInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (customCategoryOpen) customCategoryInputRef.current?.focus();
  }, [customCategoryOpen]);

  const [formData, setFormData] = useState({
    name: '',
    category: 'back-end',
    description: '',
    instructions: '',
    duration: 60,
    startTime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    endTime: '',
    totalMarks: 100,
    passingScorePercent: 40,
    negativeMarking: 0,
    shuffleQuestions: false,
    shuffleOptions: false,
    allowMultipleAttempts: false,
    maxViolations: 3,
    proctorEnabled: true,
    requireCamera: true,
    requireMicrophone: true,
    requireScreenShare: false,
    requireIdVerification: false,
  });

  const handleStartTimeChange = (startTime: string) => {
    setFormData(prev => {
      const endTimeStillValid = !prev.endTime || Boolean(calculateDurationMinutes(startTime, prev.endTime));
      if (!endTimeStillValid) {
        toast.error('End time was cleared because it is before the start time');
      }
      return {
        ...prev,
        startTime,
        endTime: endTimeStillValid ? prev.endTime : '',
      };
    });
  };

  const handleEndTimeChange = (endTime: string) => {
    if (formData.startTime && !calculateDurationMinutes(formData.startTime, endTime)) {
      toast.error('End time must be after start time');
      return;
    }
    setFormData(prev => ({ ...prev, endTime }));
  };

  const validateStep = (targetStep = step): boolean => {
    if (targetStep === 0) {
      if (!formData.name.trim()) {
        setTitleError(true);
        return false;
      }
      if (isCustomCategory && !customCategoryInput.trim()) {
        toast.error('Custom role/category is required');
        return false;
      }
      if (!srcs.library && !srcs.write) {
        toast.error('Select at least one question source');
        return false;
      }
      return true;
    }

    if (targetStep === 1) {
      if (!Number.isFinite(formData.duration) || formData.duration <= 0) {
        toast.error('Duration must be greater than 0 minutes');
        return false;
      }
      if (!Number.isFinite(formData.totalMarks) || formData.totalMarks <= 0) {
        toast.error('Total marks must be greater than 0');
        return false;
      }
      if (!Number.isFinite(formData.passingScorePercent) || formData.passingScorePercent < 0 || formData.passingScorePercent > 100) {
        toast.error('Passing score must be between 0 and 100');
        return false;
      }
      if (!Number.isFinite(formData.negativeMarking) || formData.negativeMarking < 0) {
        toast.error('Negative marking cannot be negative');
        return false;
      }
      if (!toISOStringFromLocalDateTime(formData.startTime)) {
        toast.error('Start time is required');
        return false;
      }
      if (formData.endTime && !calculateDurationMinutes(formData.startTime, formData.endTime)) {
        toast.error('End time must be after start time');
        return false;
      }
      return true;
    }

    if (targetStep === 2) {
      if (!Number.isFinite(formData.maxViolations) || formData.maxViolations < 1 || formData.maxViolations > MAX_TEST_VIOLATIONS) {
        toast.error(`Max violations must be between 1 and ${MAX_TEST_VIOLATIONS}`);
        return false;
      }
      return true;
    }

    return true;
  };

  const validateAllSteps = () => [0, 1, 2].every(validateStep);

  const handleNextStep = () => {
    if (!validateStep(step)) return;
    setStep(s => Math.min(WIZARD_STEPS.length - 1, s + 1));
  };

  useEffect(() => {
    if (isEditing) void loadTest();
  }, [testId]);

  useEffect(() => {
    scrollCardRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  const loadTest = async () => {
    try {
      const { data } = await adminApi.getTest(testId!);
      const test = data.test;
      setTestAssessmentMode(test.assessmentMode === 'NORMAL_BROWSER' ? 'NORMAL_BROWSER' : 'SEB');
      const testSettings = test.proctoringSettings && typeof test.proctoringSettings === 'object' && !Array.isArray(test.proctoringSettings)
        ? test.proctoringSettings as Record<string, unknown>
        : {};
      const loadedCategory = test.category || (typeof testSettings.category === 'string' ? testSettings.category : '') || 'back-end';
      const loadedCategoryIsCustom = !ROLE_CATEGORY_OPTIONS.some(option => option.value === loadedCategory);
      setFormData({
        name: test.name,
        category: loadedCategory,
        description: test.description || '',
        instructions: test.instructions || '',
        duration: test.duration,
        startTime: format(new Date(test.startTime), "yyyy-MM-dd'T'HH:mm"),
        endTime: test.endTime ? format(new Date(test.endTime), "yyyy-MM-dd'T'HH:mm") : '',
        totalMarks: test.totalMarks,
        passingScorePercent: marksToPercent(test.passingMarks, test.totalMarks),
        negativeMarking: test.negativeMarking,
        shuffleQuestions: test.shuffleQuestions,
        shuffleOptions: test.shuffleOptions,
        allowMultipleAttempts: test.allowMultipleAttempts,
        maxViolations: test.maxViolations,
        proctorEnabled: test.proctorEnabled || false,
        requireCamera: test.requireCamera || false,
        requireMicrophone: test.requireMicrophone || false,
        // SEB tests never require screen share regardless of what's stored — see
        // testAssessmentMode above.
        requireScreenShare: test.assessmentMode === 'SEB' ? false : (test.requireScreenShare || false),
        requireIdVerification: test.requireIdVerification || false,
      });
      setIsCustomCategory(loadedCategoryIsCustom);
      setCustomCategoryOpen(false);
      setCustomCategoryInput(loadedCategoryIsCustom ? loadedCategory : '');
    } catch {
      toast.error('Failed to load test');
      navigate('/admin/tests');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateAllSteps()) return;
    setLoading(true);
    try {
      const derivedDuration = calculateDurationMinutes(formData.startTime, formData.endTime);
      if (formData.endTime && !derivedDuration) {
        toast.error('End time must be after start time');
        setLoading(false);
        return;
      }
      const startTimeIso = toISOStringFromLocalDateTime(formData.startTime);
      if (!startTimeIso) {
        toast.error('Please enter a valid start time');
        setLoading(false);
        return;
      }
      const endTimeIso = formData.endTime ? toISOStringFromLocalDateTime(formData.endTime) : null;
      if (formData.endTime && !endTimeIso) {
        toast.error('Please enter a valid end time');
        setLoading(false);
        return;
      }

      const payload = {
        ...formData,
        startTime: startTimeIso,
        duration: formData.duration,
        endTime: endTimeIso || undefined,
        passingMarks: percentToMarks(formData.passingScorePercent, formData.totalMarks),
        // Belt-and-suspenders alongside the hidden checkbox above -- makes sure a SEB
        // test's requireScreenShare can't end up true no matter how this got here.
        requireScreenShare: testAssessmentMode === 'SEB' ? false : formData.requireScreenShare,
      };

      if (isEditing) {
        await adminApi.updateTest(testId!, payload);
        toast.success('Test updated successfully');
      } else {
        const response = await adminApi.createTest(payload);
        toast.success(`Test created! Code: ${response.data.test.testCode}`);
      }
      navigate('/admin/tests');
    } catch (error: unknown) {
      const err = error as {
        response?: { data?: { error?: string; errors?: Array<{ msg?: string }> } };
        message?: string;
      };
      const validationMessage = err.response?.data?.errors?.[0]?.msg;
      toast.error(validationMessage || err.response?.data?.error || err.message || 'Failed to save test');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    if (name === 'name' && value.trim()) setTitleError(false);
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox'
        ? (e.target as HTMLInputElement).checked
        : type === 'number'
          ? Math.max(0, Number(value) || 0)
          : value,
    }));
  };

  const focusGreen = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = 'var(--admin-accent)';
  };

  const blurGray = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = 'var(--admin-border)';
  };

  const categorySelectValue = isCustomCategory && customCategoryOpen
    ? CUSTOM_CATEGORY_VALUE
    : formData.category;
  const categorySelectOptions = [
    ...ROLE_CATEGORY_OPTIONS,
    ...(isCustomCategory && customCategoryInput.trim()
      ? [{ value: customCategoryInput.trim(), label: customCategoryInput.trim() }]
      : []),
    { value: CUSTOM_CATEGORY_VALUE, label: 'Custom' },
  ];
  const minEndTime = addMinutesToLocalDateTime(formData.startTime, 1);

  const reviewRow = (label: string, value: string | number | boolean | null | undefined) => (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <span className="text-xs font-medium text-gray-500 w-36 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-800">{value === '' || value == null ? '-' : String(value)}</span>
    </div>
  );

  return (
    <div className="create-test-page w-full flex flex-col overflow-hidden">
      <div className="flex items-start gap-3 mb-6 shrink-0">
        <BackButton mt="3px" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isEditing ? 'Edit Test' : 'Create New Test'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {isEditing ? 'Update assessment details and rules' : 'Set up an assessment with timing, security, and question sources'}
          </p>
        </div>
      </div>

      <div className="shrink-0">
        <StepIndicator current={step} />
      </div>

      <form id="test-form" onSubmit={handleSubmit} className="flex-1 min-h-0 mb-5">
        <div ref={scrollCardRef} className="create-test-scroll-card bg-white rounded-xl border border-gray-200 shadow-sm p-6 h-full overflow-y-scroll">
          {step === 0 && (
            <div className="space-y-7">
              <section>
                <FormGroupTitle>Basic Information</FormGroupTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label style={labelStyle}>Test title <span style={{ color: '#EF4444' }}>*</span></label>
                    <input
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      required
                      placeholder="e.g. Back-End Developer - Node.js"
                      style={titleError ? { ...inputStyle, borderColor: '#EF4444' } : inputStyle}
                      onFocus={focusGreen}
                      onBlur={blurGray}
                    />
                    {titleError && (
                      <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#EF4444' }}>Please fill this field</p>
                    )}
                  </div>
                  <div>
                    <label style={labelStyle}>Role / category</label>
                    <CustomSelect
                      value={categorySelectValue}
                      onChange={category => {
                        if (category === CUSTOM_CATEGORY_VALUE) {
                          setIsCustomCategory(true);
                          setCustomCategoryOpen(true);
                          setCustomCategoryInput('');
                          setFormData(prev => ({ ...prev, category: '' }));
                          return;
                        }
                        const isPreset = ROLE_CATEGORY_OPTIONS.some(option => option.value === category);
                        if (!isPreset && isCustomCategory) {
                          // Re-opened their own already-typed custom entry — let them edit it, not re-pick it.
                          setCustomCategoryOpen(true);
                          return;
                        }
                        setIsCustomCategory(false);
                        setCustomCategoryOpen(false);
                        setCustomCategoryInput('');
                        setFormData(prev => ({ ...prev, category }));
                      }}
                      options={categorySelectOptions}
                      style={{ width: '100%', minWidth: 0 }}
                    />
                    {isCustomCategory && customCategoryOpen && (
                      <input
                        ref={customCategoryInputRef}
                        type="text"
                        value={customCategoryInput}
                        onChange={e => {
                          const category = e.target.value;
                          setCustomCategoryInput(category);
                          setFormData(prev => ({ ...prev, category }));
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (customCategoryInput.trim()) setCustomCategoryOpen(false);
                          }
                        }}
                        placeholder="Type custom role/category, then press Enter"
                        style={{ ...inputStyle, marginTop: '8px' }}
                        onFocus={focusGreen}
                        onBlur={blurGray}
                      />
                    )}
                  </div>
                  <div>
                    <label style={labelStyle}>Test code</label>
                    <input
                      value="AUTO-GENERATED"
                      disabled
                      style={{ ...inputStyle, backgroundColor: '#F9FAFB', color: 'var(--admin-text-subtle)', cursor: 'not-allowed' }}
                    />
                    <p className="mt-1 text-[11px] text-gray-400">Auto-generated after creation.</p>
                  </div>
                </div>
                <div className="mt-4">
                  <label style={labelStyle}>Description</label>
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleChange}
                    placeholder="Assesses REST API design, async patterns, SQL and debugging for mid-level Node.js engineers."
                    rows={4}
                    style={{ ...inputStyle, lineHeight: '1.6', resize: 'none' }}
                    onFocus={focusGreen}
                    onBlur={blurGray}
                  />
                </div>
                <div className="mt-4">
                  <label style={labelStyle}>Instructions for candidates</label>
                  <textarea
                    name="instructions"
                    value={formData.instructions}
                    onChange={handleChange}
                    placeholder="Enter test rules and instructions..."
                    rows={3}
                    style={{ ...inputStyle, lineHeight: '1.6', resize: 'none' }}
                    onFocus={focusGreen}
                    onBlur={blurGray}
                  />
                  <p className="mt-1 text-[11px] text-gray-400">Shown to candidates on the instructions screen.</p>
                </div>
              </section>

              <hr className="border-gray-100" />

              <section>
                <FormGroupTitle sub="Choose how questions will be added after the test is created">Question Sources</FormGroupTitle>
                <div className="border border-gray-200 rounded-xl px-4">
                  <SourceRow
                    checked={srcs.library}
                    onChange={() => setSrcs(p => ({ ...p, library: !p.library }))}
                    label="From Question Library"
                    icon={<FileText width={15} height={15} stroke="var(--admin-text-subtle)" strokeWidth={1.5} />}
                  />
                  <SourceRow
                    checked={srcs.write}
                    onChange={() => setSrcs(p => ({ ...p, write: !p.write }))}
                    label="Write new questions"
                    icon={<Plus width={15} height={15} stroke="var(--admin-text-subtle)" strokeWidth={1.5} />}
                  />
                </div>
              </section>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-9">
              <section>
                <FormGroupTitle>Format & Difficulty</FormGroupTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label style={labelStyle}>Duration (minutes) <span style={{ color: '#EF4444' }}>*</span></label>
                    <input type="number" name="duration" min={1} value={formData.duration} onChange={handleChange} required style={inputStyle} onFocus={focusGreen} onBlur={blurGray} />
                  </div>
                  <div>
                    <label style={labelStyle}>Passing score (%)</label>
                    <input type="number" name="passingScorePercent" value={formData.passingScorePercent} onChange={handleChange} style={inputStyle} onFocus={focusGreen} onBlur={blurGray} />
                  </div>
                  <div>
                    <label style={labelStyle}>Total marks <span style={{ color: '#EF4444' }}>*</span></label>
                    <input type="number" name="totalMarks" value={formData.totalMarks} onChange={handleChange} required style={inputStyle} onFocus={focusGreen} onBlur={blurGray} />
                  </div>
                  <div>
                    <label style={labelStyle}>Negative marking</label>
                    <input type="number" name="negativeMarking" value={formData.negativeMarking} onChange={handleChange} style={inputStyle} onFocus={focusGreen} onBlur={blurGray} />
                  </div>
                </div>
                <div className="mt-6">
                  <label style={labelStyle}>Difficulty</label>
                  <div className="flex flex-wrap gap-2">
                    {(['easy', 'medium', 'hard', 'mixed'] as const).map(d => {
                      const active = difficulty === d;
                      const label = d.charAt(0).toUpperCase() + d.slice(1);
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDifficulty(d)}
                          className={active ? 'btn btn-primary' : 'btn btn-secondary'}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>

              <hr className="border-gray-100" />

              <section style={{ paddingTop: '4px' }}>
                <FormGroupTitle>Schedule</FormGroupTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label style={labelStyle}>Start time <span style={{ color: '#EF4444' }}>*</span></label>
                    <DateTimePicker value={formData.startTime} onChange={handleStartTimeChange} placeholder="Select start date & time" style={{ width: '100%' }} />
                  </div>
                  <div>
                    <label style={labelStyle}>End time <span style={{ color: 'var(--admin-text-subtle)', fontWeight: 400 }}>(optional)</span></label>
                    <DateTimePicker value={formData.endTime} onChange={handleEndTimeChange} minDateTime={minEndTime} placeholder="Select end date & time" style={{ width: '100%' }} />
                  </div>
                </div>
              </section>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-7">
              <section>
                <FormGroupTitle sub="Configure candidate monitoring and attempt behavior">AI Proctoring</FormGroupTitle>
                <div className="space-y-3">
                  <CheckOption name="proctorEnabled" checked={formData.proctorEnabled} onChange={handleChange} label="Enable live AI proctoring" />
                  <CheckOption name="requireCamera" checked={formData.requireCamera} onChange={handleChange} label="Require camera access" disabled={!formData.proctorEnabled} />
                  <CheckOption name="requireMicrophone" checked={formData.requireMicrophone} onChange={handleChange} label="Require microphone access" disabled={!formData.proctorEnabled} />
                  {testAssessmentMode !== 'SEB' && (
                    <CheckOption name="requireScreenShare" checked={formData.requireScreenShare} onChange={handleChange} label="Require screen share" disabled={!formData.proctorEnabled} />
                  )}
                  {testAssessmentMode === 'SEB' && (
                    <p className="text-xs text-gray-400 pl-1">
                      Screen share isn't available for Safe Exam Browser tests — SEB's own lockdown already
                      prevents switching apps/windows, and screen capture isn't reliably supported across all
                      SEB versions.
                    </p>
                  )}
                  <CheckOption name="requireIdVerification" checked={formData.requireIdVerification} onChange={handleChange} label="Require ID verification before test" />
                </div>
              </section>

              <hr className="border-gray-100" />

              <section>
                <FormGroupTitle>Attempt Rules</FormGroupTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label style={labelStyle}>Max violations <span style={{ color: '#EF4444' }}>*</span></label>
                    <input type="number" name="maxViolations" value={formData.maxViolations} onChange={handleChange} min={1} max={MAX_TEST_VIOLATIONS} style={inputStyle} onFocus={focusGreen} onBlur={blurGray} />
                  </div>
                  <div className="space-y-3 pt-6">
                    <CheckOption name="shuffleQuestions" checked={formData.shuffleQuestions} onChange={handleChange} label="Shuffle questions for each candidate" />
                    <CheckOption name="shuffleOptions" checked={formData.shuffleOptions} onChange={handleChange} label="Shuffle MCQ options" />
                    <CheckOption name="allowMultipleAttempts" checked={formData.allowMultipleAttempts} onChange={handleChange} label="Allow multiple attempts" />
                  </div>
                </div>
              </section>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                  <p className="text-sm font-semibold text-gray-700">Test Details</p>
                </div>
                <div className="px-5 py-1">
                  {reviewRow('Title', formData.name)}
                  {reviewRow('Description', formData.description)}
                  {reviewRow('Duration', `${formData.duration} minutes`)}
                  {reviewRow('Difficulty', difficulty.charAt(0).toUpperCase() + difficulty.slice(1))}
                  {reviewRow('Schedule', formData.endTime ? `${formData.startTime} - ${formData.endTime}` : formData.startTime)}
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                  <p className="text-sm font-semibold text-gray-700">Scoring & Security</p>
                </div>
                <div className="px-5 py-1">
                  {reviewRow('Total Marks', formData.totalMarks)}
                  {reviewRow('Passing Score', `${formData.passingScorePercent}%`)}
                  {reviewRow('Negative Marking', formData.negativeMarking)}
                  {reviewRow('Proctoring', formData.proctorEnabled ? 'Enabled' : 'Disabled')}
                  {reviewRow('Max Violations', formData.maxViolations)}
                </div>
              </div>
            </div>
          )}
        </div>
      </form>

      <div className="flex items-center justify-between shrink-0">
        <button
          type="button"
          onClick={() => (step === 0 ? navigate('/admin/tests') : setStep(s => Math.max(0, s - 1)))}
          className="btn btn-secondary"
        >
          <ArrowLeft width={13} height={13} strokeWidth={2} />
          {step === 0 ? 'Cancel' : 'Back'}
        </button>

        {step < WIZARD_STEPS.length - 1 ? (
          <button
            type="button"
            onClick={handleNextStep}
            className="btn btn-primary"
          >
            {step === WIZARD_STEPS.length - 2 ? 'Review' : 'Next'} <ArrowRight width={13} height={13} strokeWidth={2} />
          </button>
        ) : (
          <button
            type="submit"
            form="test-form"
            disabled={loading}
            className="btn btn-primary"
          >
            {loading ? (
              <>
                <span className="animate-spin" style={{ width: '14px', height: '14px', borderRadius: '50%', border: '2px solid white', borderTopColor: 'transparent', display: 'inline-block' }} />
                Saving...
              </>
            ) : (
              <>
                <Check width={13} height={13} strokeWidth={2} />
                {isEditing ? 'Save Changes' : 'Create Test'}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
