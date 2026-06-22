import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { format } from 'date-fns';
import DateTimePicker from '../../components/DateTimePicker';
import { Check, ChevronRight, FileText, Plus, Sparkles, Upload } from 'lucide-react';
import BackButton from '../../components/BackButton';

/* ── Helpers (unchanged) ── */
function calculateDurationMinutes(startTime: string, endTime: string): number | null {
  if (!startTime || !endTime) return null;
  const startDate = new Date(startTime);
  const endDate   = new Date(endTime);
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

/* ── Styled checkbox ── */
function CheckOption({ name, checked, onChange, label, disabled }: {
  name: string; checked: boolean; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  label: string; disabled?: boolean;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: disabled ? 'not-allowed' : 'pointer', padding: '2px 0', opacity: disabled ? 0.5 : 1 }}>
      <div style={{
        width: '18px', height: '18px', borderRadius: '5px', flexShrink: 0,
        border: checked ? '2px solid #F59E0B' : '2px solid #D1D5DB',
        backgroundColor: checked ? '#F59E0B' : 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: disabled ? 'none' : 'auto',
      }}>
        {checked && (
          <Check width={10} height={10} stroke="white" strokeWidth={2} />
        )}
      </div>
      <input type="checkbox" name={name} checked={checked} onChange={onChange} disabled={disabled}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
      <span style={{ fontSize: '13px', color: '#434B5E' }}>{label}</span>
    </label>
  );
}

/* ── Source option with icon ── */
function SourceRow({ icon, label, checked, onChange }: {
  icon: React.ReactNode; label: string; checked: boolean; onChange: () => void;
}) {
  return (
    <label onClick={onChange} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 4px', cursor: 'pointer', borderBottom: '1px solid #F3F4F6' }}>
      <div style={{
        width: '20px', height: '20px', borderRadius: '5px', flexShrink: 0,
        border: checked ? '2px solid #F59E0B' : '2px solid #D1D5DB',
        backgroundColor: checked ? '#F59E0B' : 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {checked && (
          <Check width={10} height={10} stroke="white" strokeWidth={2} />
        )}
      </div>
      {icon}
      <span style={{ fontSize: '13px', color: '#434B5E' }}>{label}</span>
    </label>
  );
}

/* ── Input styles ── */
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: '10px',
  border: '1.5px solid #E5E7EB', fontSize: '13px', color: '#11162A',
  outline: 'none', boxSizing: 'border-box', backgroundColor: 'white',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '12px', fontWeight: 600, color: '#434B5E', marginBottom: '7px',
};
const sectionTitle: React.CSSProperties = {
  fontSize: '10px', fontWeight: 700, letterSpacing: '0.09em', color: '#98A2B5', margin: '0 0 18px',
};
const card: React.CSSProperties = {
  backgroundColor: 'white', borderRadius: '18px', padding: '24px',
  border: '1px solid #E5E7EB', boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  marginBottom: '16px',
};

/* ═══════════════════════════════════════════ */
export default function TestForm() {
  const { testId } = useParams();
  const navigate   = useNavigate();
  const isEditing  = !!testId;

  const [loading,    setLoading]    = useState(false);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard' | 'mixed'>('mixed');

  /* Question source toggles (UI-only) */
  const [srcs, setSrcs] = useState({ library: true, write: true, ai: false, csv: false });

  const [formData, setFormData] = useState({
    name: '',
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

  useEffect(() => {
    if (isEditing) void loadTest();
  }, [testId]);

  const loadTest = async () => {
    try {
      const { data } = await adminApi.getTest(testId!);
      const test = data.test;
      setFormData({
        name:                 test.name,
        description:          test.description || '',
        instructions:         test.instructions || '',
        duration:             test.duration,
        startTime:            format(new Date(test.startTime), "yyyy-MM-dd'T'HH:mm"),
        endTime:              test.endTime ? format(new Date(test.endTime), "yyyy-MM-dd'T'HH:mm") : '',
        totalMarks:           test.totalMarks,
        passingMarks:         test.passingMarks || 0,
        negativeMarking:      test.negativeMarking,
        shuffleQuestions:     test.shuffleQuestions,
        shuffleOptions:       test.shuffleOptions,
        allowMultipleAttempts:test.allowMultipleAttempts,
        maxViolations:        test.maxViolations,
        proctorEnabled:       test.proctorEnabled || false,
        requireCamera:        test.requireCamera || false,
        requireMicrophone:    test.requireMicrophone || false,
        requireScreenShare:   test.requireScreenShare || false,
        requireIdVerification:test.requireIdVerification || false,
      });
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
        duration:  formData.duration,
        endTime:   endTimeIso || undefined,
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
    } finally { setLoading(false); }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked
            : type === 'number'   ? Number(value)
            : value,
    }));
  };

  const focusGreen = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = '#F59E0B';
  };
  const blurGray = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = '#E5E7EB';
  };

  return (
    <div style={{ backgroundColor: '#F9FAFB', minHeight: '100%' }}>

      {/* ── HEADER ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#98A2B5', marginBottom: '10px' }}>
            <span style={{ cursor: 'pointer', color: '#F59E0B' }} onClick={() => navigate('/admin/tests')}>Assessments</span>
            <ChevronRight width={12} height={12} strokeWidth={1.5} />
            <span>New test</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <BackButton mt="3px" />
            <div>
              <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#11162A', margin: 0 }}>
                {isEditing ? 'Edit Test' : 'Create Test'}
              </h1>
              <p style={{ fontSize: '13px', color: '#6A7387', margin: '4px 0 0' }}>
                Set up the assessment basics. You'll add questions next.
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <button type="button" onClick={() => navigate('/admin/tests')}
            style={{ padding: '10px 20px', borderRadius: '10px', border: '1.5px solid #E5E7EB', backgroundColor: 'white', fontSize: '13px', fontWeight: 500, color: '#434B5E', cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="submit" form="test-form" disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '10px 22px', borderRadius: '10px', border: 'none',
              backgroundColor: loading ? '#FDE68A' : '#F59E0B',
              fontSize: '13px', fontWeight: 600, color: 'white',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}>
            {loading ? (
              <>
                <span className="animate-spin" style={{ width: '14px', height: '14px', borderRadius: '50%', border: '2px solid white', borderTopColor: 'transparent', display: 'inline-block' }} />
                Saving...
              </>
            ) : (
              <>
                <Check width={13} height={13} stroke="white" strokeWidth={2} />
                {isEditing ? 'Save changes' : 'Create & add questions'}
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── FORM ── */}
      <form id="test-form" onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px', alignItems: 'start' }}>

          {/* ════ LEFT COLUMN ════ */}
          <div>

            {/* BASICS */}
            <div style={card}>
              <p style={sectionTitle}>BASICS</p>

              {/* Test title */}
              <div style={{ marginBottom: '18px' }}>
                <label style={labelStyle}>Test title <span style={{ color: '#EF4444' }}>*</span></label>
                <input type="text" name="name" value={formData.name} onChange={handleChange} required
                  placeholder="e.g. Back-End Developer — Node.js"
                  style={inputStyle} onFocus={focusGreen} onBlur={blurGray} />
              </div>

              {/* Description */}
              <div style={{ marginBottom: '8px' }}>
                <label style={labelStyle}>Description</label>
                <textarea name="description" value={formData.description} onChange={handleChange}
                  placeholder="Assesses REST API design, async patterns, SQL and debugging for mid-level Node.js engineers."
                  rows={4} style={{ ...inputStyle, lineHeight: '1.6' }}
                  onFocus={focusGreen} onBlur={blurGray} />
              </div>
              <p style={{ fontSize: '12px', color: '#98A2B5', margin: '0 0 18px' }}>Shown to candidates on the instructions screen.</p>

              {/* Instructions */}
              <div style={{ marginBottom: '18px' }}>
                <label style={labelStyle}>Instructions for candidates</label>
                <textarea name="instructions" value={formData.instructions} onChange={handleChange}
                  placeholder="Enter test rules and instructions..."
                  rows={3} style={{ ...inputStyle, lineHeight: '1.6' }}
                  onFocus={focusGreen} onBlur={blurGray} />
              </div>

              {/* Role / Test Code */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label style={labelStyle}>Role / category</label>
                  <select name="category" onChange={handleChange}
                    style={{ ...inputStyle, cursor: 'pointer', appearance: 'auto' }}>
                    <option value="back-end">Back-End Developer</option>
                    <option value="front-end">Front-End Developer</option>
                    <option value="full-stack">Full Stack Developer</option>
                    <option value="devops">DevOps Engineer</option>
                    <option value="data">Data Scientist</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Test code</label>
                  <input value="AUTO-GENERATED" disabled
                    style={{ ...inputStyle, backgroundColor: '#F9FAFB', color: '#98A2B5', cursor: 'not-allowed' }} />
                  <p style={{ fontSize: '11px', color: '#98A2B5', margin: '4px 0 0' }}>Auto-generated, editable.</p>
                </div>
              </div>
            </div>

            {/* FORMAT & DIFFICULTY */}
            <div style={card}>
              <p style={sectionTitle}>FORMAT & DIFFICULTY</p>

              {/* Duration + Passing marks */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '18px' }}>
                <div>
                  <label style={labelStyle}>Duration (minutes) <span style={{ color: '#EF4444' }}>*</span></label>
                  <input type="number" name="duration" value={formData.duration} onChange={handleChange} min={1} required
                    style={inputStyle} onFocus={focusGreen} onBlur={blurGray} />
                </div>
                <div>
                  <label style={labelStyle}>Passing score (%)</label>
                  <input type="number" name="passingMarks" value={formData.passingMarks} onChange={handleChange} min={0}
                    style={inputStyle} onFocus={focusGreen} onBlur={blurGray} />
                </div>
              </div>

              {/* Difficulty pills */}
              <div style={{ marginBottom: '18px' }}>
                <label style={labelStyle}>Difficulty</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {(['easy', 'medium', 'hard', 'mixed'] as const).map(d => {
                    const active = difficulty === d;
                    const label  = d.charAt(0).toUpperCase() + d.slice(1);
                    return (
                      <button key={d} type="button" onClick={() => setDifficulty(d)}
                        style={{
                          padding: '7px 18px', borderRadius: '10px', fontSize: '13px',
                          fontWeight: active ? 600 : 400, cursor: 'pointer',
                          border: `1.5px solid ${active ? '#F59E0B' : '#E5E7EB'}`,
                          backgroundColor: active ? '#FFFBEB' : 'white',
                          color: active ? '#D97706' : '#6A7387',
                        }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Max Violations */}
              <div style={{ marginBottom: '18px' }}>
                <label style={labelStyle}>Max violations <span style={{ color: '#EF4444' }}>*</span></label>
                <input type="number" name="maxViolations" value={formData.maxViolations} onChange={handleChange} min={1}
                  style={{ ...inputStyle, width: '50%' }} onFocus={focusGreen} onBlur={blurGray} />
              </div>

              {/* Start + End Time */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '18px' }}>
                <div>
                  <label style={labelStyle}>Start time <span style={{ color: '#EF4444' }}>*</span></label>
                  <DateTimePicker
                    value={formData.startTime}
                    onChange={v => setFormData(p => ({ ...p, startTime: v }))}
                    placeholder="Select start date & time"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>End time <span style={{ color: '#98A2B5', fontWeight: 400 }}>(optional)</span></label>
                  <DateTimePicker
                    value={formData.endTime}
                    onChange={v => setFormData(p => ({ ...p, endTime: v }))}
                    placeholder="Select end date & time"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              {/* Total Marks + Negative Marking */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label style={labelStyle}>Total marks <span style={{ color: '#EF4444' }}>*</span></label>
                  <input type="number" name="totalMarks" value={formData.totalMarks} onChange={handleChange} min={1} required
                    style={inputStyle} onFocus={focusGreen} onBlur={blurGray} />
                </div>
                <div>
                  <label style={labelStyle}>Negative marking</label>
                  <input type="number" name="negativeMarking" value={formData.negativeMarking} onChange={handleChange} min={0} step={0.25}
                    style={inputStyle} onFocus={focusGreen} onBlur={blurGray} />
                </div>
              </div>
            </div>

            {/* AI PROCTORING */}
            <div style={card}>
              <p style={sectionTitle}>AI PROCTORING</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <CheckOption name="proctorEnabled"       checked={formData.proctorEnabled}       onChange={handleChange} label="Enable live AI proctoring" />
                <CheckOption name="requireCamera"        checked={formData.requireCamera}        onChange={handleChange} label="Require camera access"          disabled={!formData.proctorEnabled} />
                <CheckOption name="requireMicrophone"    checked={formData.requireMicrophone}    onChange={handleChange} label="Require microphone access"      disabled={!formData.proctorEnabled} />
                <CheckOption name="requireScreenShare"   checked={formData.requireScreenShare}   onChange={handleChange} label="Require screen share"           disabled={!formData.proctorEnabled} />
                <CheckOption name="requireIdVerification"checked={formData.requireIdVerification}onChange={handleChange} label="Require ID verification before test" />
                <div style={{ height: '1px', backgroundColor: '#F3F4F6', margin: '4px 0' }} />
                <CheckOption name="shuffleQuestions"     checked={formData.shuffleQuestions}     onChange={handleChange} label="Shuffle questions for each candidate" />
                <CheckOption name="shuffleOptions"       checked={formData.shuffleOptions}       onChange={handleChange} label="Shuffle MCQ options" />
                <CheckOption name="allowMultipleAttempts"checked={formData.allowMultipleAttempts}onChange={handleChange} label="Allow multiple attempts" />
              </div>
            </div>

          </div>

          {/* ════ RIGHT SIDEBAR ════ */}
          <div>

            {/* Question sources */}
            <div style={{ ...card, marginBottom: '16px' }}>
              <p style={{ fontSize: '14px', fontWeight: 700, color: '#11162A', margin: '0 0 14px' }}>Question sources</p>
              <SourceRow
                checked={srcs.library} onChange={() => setSrcs(p => ({ ...p, library: !p.library }))}
                label="From Question Library"
                icon={<FileText width={15} height={15} stroke="#98A2B5" strokeWidth={1.5} />}
              />
              <SourceRow
                checked={srcs.write} onChange={() => setSrcs(p => ({ ...p, write: !p.write }))}
                label="Write new questions"
                icon={<Plus width={15} height={15} stroke="#98A2B5" strokeWidth={1.5} />}
              />
              <SourceRow
                checked={srcs.ai} onChange={() => setSrcs(p => ({ ...p, ai: !p.ai }))}
                label="AI-generate questions"
                icon={<Sparkles width={15} height={15} stroke="#98A2B5" strokeWidth={1.5} />}
              />
              <div style={{ borderBottom: 'none' }}>
                <SourceRow
                  checked={srcs.csv} onChange={() => setSrcs(p => ({ ...p, csv: !p.csv }))}
                  label="Import from CSV"
                  icon={<Upload width={15} height={15} stroke="#98A2B5" strokeWidth={1.5} />}
                />
              </div>
            </div>

            {/* Shortcut — AI Generator */}
            <div style={{
              borderRadius: '18px', padding: '20px',
              backgroundColor: '#FFFBEB', border: '1px solid #BBF7D0',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
                <Sparkles width={15} height={15} stroke="#F59E0B" strokeWidth={1.5} />
                <span style={{ fontSize: '14px', fontWeight: 700, color: '#D97706' }}>Shortcut</span>
              </div>
              <p style={{ fontSize: '12px', color: '#6A7387', margin: '0 0 14px', lineHeight: '1.6' }}>
                Skip manual setup — generate a full role-based test from a job description.
              </p>
              <button type="button" onClick={() => navigate('/admin/tests/agent')}
                style={{
                  width: '100%', padding: '11px', borderRadius: '10px', border: 'none',
                  backgroundColor: '#F59E0B', color: 'white', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                }}>
                Use AI Generator
              </button>
            </div>

          </div>
        </div>
      </form>
    </div>
  );
}
