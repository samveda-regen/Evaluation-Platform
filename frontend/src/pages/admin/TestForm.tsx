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
  Upload,
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
const ROLE_CATEGORY_OPTIONS = [
  { value: 'back-end', label: 'Back-End Developer' },
  { value: 'front-end', label: 'Front-End Developer' },
  { value: 'full-stack', label: 'Full Stack Developer' },
  { value: 'devops', label: 'DevOps Engineer' },
  { value: 'data', label: 'Data Scientist' },
];

function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
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
  const [loading, setLoading] = useState(false);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard' | 'mixed'>('mixed');
  const [srcs, setSrcs] = useState({ library: true, write: true, csv: false });
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [customCategoryInput, setCustomCategoryInput] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    category: 'back-end',
    description: '',
    instructions: '',
    duration: 60,
    startTime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    endTime: '',
    totalMarks: 100,
    passingMarks: 40,
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
      const loadedCategory = test.category || 'back-end';
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
        passingMarks: test.passingMarks || 0,
        negativeMarking: test.negativeMarking,
        shuffleQuestions: test.shuffleQuestions,
        shuffleOptions: test.shuffleOptions,
        allowMultipleAttempts: test.allowMultipleAttempts,
        maxViolations: test.maxViolations,
        proctorEnabled: test.proctorEnabled || false,
        requireCamera: test.requireCamera || false,
        requireMicrophone: test.requireMicrophone || false,
        requireScreenShare: test.requireScreenShare || false,
        requireIdVerification: test.requireIdVerification || false,
      });
      setIsCustomCategory(loadedCategoryIsCustom);
      setCustomCategoryInput(loadedCategoryIsCustom ? loadedCategory : '');
    } catch {
      toast.error('Failed to load test');
      navigate('/admin/tests');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox'
        ? (e.target as HTMLInputElement).checked
        : type === 'number'
          ? Number(value)
          : value,
    }));
  };

  const focusGreen = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = 'var(--admin-accent)';
  };

  const blurGray = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = 'var(--admin-border)';
  };

  const categorySelectValue = isCustomCategory && !customCategoryInput.trim()
    ? CUSTOM_CATEGORY_VALUE
    : formData.category;
  const categorySelectOptions = [
    ...ROLE_CATEGORY_OPTIONS,
    ...(isCustomCategory && customCategoryInput.trim()
      ? [{ value: customCategoryInput.trim(), label: customCategoryInput.trim() }]
      : []),
    { value: CUSTOM_CATEGORY_VALUE, label: 'Custom' },
  ];

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
                <SectionTitle>Basic Information</SectionTitle>
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
                      style={inputStyle}
                      onFocus={focusGreen}
                      onBlur={blurGray}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Role / category</label>
                    {isCustomCategory ? (
                      <input
                        type="text"
                        value={customCategoryInput}
                        onChange={e => {
                          const category = e.target.value;
                          setCustomCategoryInput(category);
                          setFormData(prev => ({ ...prev, category }));
                        }}
                        placeholder="Type custom role/category"
                        style={inputStyle}
                        onFocus={focusGreen}
                        onBlur={blurGray}
                      />
                    ) : (
                      <CustomSelect
                        value={categorySelectValue}
                        onChange={category => {
                          if (category === CUSTOM_CATEGORY_VALUE) {
                            setIsCustomCategory(true);
                            setCustomCategoryInput('');
                            setFormData(prev => ({ ...prev, category: '' }));
                            return;
                          }
                          setIsCustomCategory(false);
                          setCustomCategoryInput('');
                          setFormData(prev => ({ ...prev, category }));
                        }}
                        options={categorySelectOptions}
                        style={{ width: '100%', minWidth: 0 }}
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
                <SectionTitle sub="Choose how questions will be added after the test is created">Question Sources</SectionTitle>
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
                  <SourceRow
                    checked={srcs.csv}
                    onChange={() => setSrcs(p => ({ ...p, csv: !p.csv }))}
                    label="Import from CSV"
                    icon={<Upload width={15} height={15} stroke="var(--admin-text-subtle)" strokeWidth={1.5} />}
                  />
                </div>
              </section>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-9">
              <section>
                <SectionTitle>Format & Difficulty</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label style={labelStyle}>Duration (minutes) <span style={{ color: '#EF4444' }}>*</span></label>
                    <input type="number" name="duration" value={formData.duration} onChange={handleChange} required style={inputStyle} onFocus={focusGreen} onBlur={blurGray} />
                  </div>
                  <div>
                    <label style={labelStyle}>Passing score (%)</label>
                    <input type="number" name="passingMarks" value={formData.passingMarks} onChange={handleChange} style={inputStyle} onFocus={focusGreen} onBlur={blurGray} />
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
                <SectionTitle>Schedule</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label style={labelStyle}>Start time <span style={{ color: '#EF4444' }}>*</span></label>
                    <DateTimePicker value={formData.startTime} onChange={handleStartTimeChange} placeholder="Select start date & time" style={{ width: '100%' }} />
                  </div>
                  <div>
                    <label style={labelStyle}>End time <span style={{ color: 'var(--admin-text-subtle)', fontWeight: 400 }}>(optional)</span></label>
                    <DateTimePicker value={formData.endTime} onChange={handleEndTimeChange} minDateTime={formData.startTime} placeholder="Select end date & time" style={{ width: '100%' }} />
                  </div>
                </div>
              </section>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-7">
              <section>
                <SectionTitle sub="Configure candidate monitoring and attempt behavior">AI Proctoring</SectionTitle>
                <div className="space-y-3">
                  <CheckOption name="proctorEnabled" checked={formData.proctorEnabled} onChange={handleChange} label="Enable live AI proctoring" />
                  <CheckOption name="requireCamera" checked={formData.requireCamera} onChange={handleChange} label="Require camera access" disabled={!formData.proctorEnabled} />
                  <CheckOption name="requireMicrophone" checked={formData.requireMicrophone} onChange={handleChange} label="Require microphone access" disabled={!formData.proctorEnabled} />
                  <CheckOption name="requireScreenShare" checked={formData.requireScreenShare} onChange={handleChange} label="Require screen share" disabled={!formData.proctorEnabled} />
                  <CheckOption name="requireIdVerification" checked={formData.requireIdVerification} onChange={handleChange} label="Require ID verification before test" />
                </div>
              </section>

              <hr className="border-gray-100" />

              <section>
                <SectionTitle>Attempt Rules</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label style={labelStyle}>Max violations <span style={{ color: '#EF4444' }}>*</span></label>
                    <input type="number" name="maxViolations" value={formData.maxViolations} onChange={handleChange} style={inputStyle} onFocus={focusGreen} onBlur={blurGray} />
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
                  {reviewRow('Passing Score', `${formData.passingMarks}%`)}
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
            onClick={() => setStep(s => Math.min(WIZARD_STEPS.length - 1, s + 1))}
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
