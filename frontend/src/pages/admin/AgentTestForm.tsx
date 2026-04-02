import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';

interface JobProfile {
  title: string;
  experience: string;
  description: string;
}

interface QuestionSelection {
  mcqQuestionIds: string[];
  codingQuestionIds: string[];
  reasoning: string;
  suggestedDuration: number;
  suggestedTestName: string;
  suggestedDescription: string;
}

interface TestSettings {
  name: string;
  description: string;
  duration: number;
  startTime: string;
  endTime: string;
  passingMarks: number;
  negativeMarking: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  maxViolations: number;
}

export default function AgentTestForm() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // Step 1: Job Profile
  const [jobProfile, setJobProfile] = useState<JobProfile>({
    title: '',
    experience: '0-2 years',
    description: ''
  });

  // Step 2: Skills and Difficulty
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard' | 'mixed'>('medium');
  const [mcqCount, setMcqCount] = useState(10);
  const [codingCount, setCodingCount] = useState(2);

  // Step 3: Generated Selection
  const [selection, setSelection] = useState<QuestionSelection | null>(null);

  // Step 4: Test Settings
  const [testSettings, setTestSettings] = useState<TestSettings>({
    name: '',
    description: '',
    duration: 60,
    startTime: '',
    endTime: '',
    passingMarks: 0,
    negativeMarking: 0,
    shuffleQuestions: true,
    shuffleOptions: true,
    maxViolations: 3
  });

  const addSkill = () => {
    const skill = skillInput.trim().toLowerCase();
    if (skill && !skills.includes(skill)) {
      setSkills([...skills, skill]);
      setSkillInput('');
    }
  };

  const removeSkill = (skillToRemove: string) => {
    setSkills(skills.filter(s => s !== skillToRemove));
  };

  const handleAnalyzeJob = async () => {
    if (!jobProfile.title.trim()) {
      toast.error('Job title is required');
      return;
    }

    setAnalyzing(true);
    try {
      const { data } = await adminApi.analyzeJob(jobProfile.title, jobProfile.description);
      if (data.success && data.data) {
        setSkills(data.data.suggestedSkills || []);
        setDifficulty(data.data.suggestedDifficulty || 'medium');
        setMcqCount(data.data.suggestedMcqCount || 10);
        setCodingCount(data.data.suggestedCodingCount || 2);
        setJobProfile({
          ...jobProfile,
          experience: data.data.experienceLevel || jobProfile.experience
        });
        toast.success('Job analyzed! Review suggested skills and settings');
        setStep(2);
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string; message?: string } } };
      toast.error(err.response?.data?.message || err.response?.data?.error || 'Failed to analyze job');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleGenerateTest = async () => {
    if (skills.length === 0) {
      toast.error('At least one skill is required');
      return;
    }

    if (mcqCount === 0 && codingCount === 0) {
      toast.error('At least one question type must have count > 0');
      return;
    }

    setLoading(true);
    try {
      const { data } = await adminApi.generateTest({
        jobProfile,
        skills,
        difficulty,
        mcqCount,
        codingCount
      });

      if (data.success && data.data) {
        setSelection(data.data);
        setTestSettings({
          ...testSettings,
          name: data.data.suggestedTestName || `${jobProfile.title} Assessment`,
          description: data.data.suggestedDescription || '',
          duration: data.data.suggestedDuration || 60
        });
        toast.success('Test generated! Review the selection');
        setStep(3);
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string; message?: string } } };
      toast.error(err.response?.data?.message || err.response?.data?.error || 'Failed to generate test');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTest = async () => {
    if (!selection) {
      toast.error('No test selection available');
      return;
    }

    if (!testSettings.startTime) {
      toast.error('Start time is required');
      return;
    }

    setLoading(true);
    try {
      const { data } = await adminApi.createTestFromAgent({
        selection,
        testSettings: {
          ...testSettings,
          startTime: new Date(testSettings.startTime).toISOString(),
          endTime: testSettings.endTime ? new Date(testSettings.endTime).toISOString() : undefined
        }
      });

      if (data.success && data.data) {
        toast.success(`Test created! Code: ${data.data.testCode}`);
        navigate(`/admin/tests/${data.data.testId}`);
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string; message?: string } } };
      toast.error(err.response?.data?.message || err.response?.data?.error || 'Failed to create test');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-2">AI Test Generator</h1>
      <p className="text-gray-600 mb-6">
        Let AI help you create a test by analyzing job requirements and selecting appropriate questions
      </p>

      {/* Progress Steps */}
      <div className="flex items-center mb-8">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${
                step >= s
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-200 text-gray-500'
              }`}
            >
              {s}
            </div>
            {s < 4 && (
              <div
                className={`w-16 h-1 ${
                  step > s ? 'bg-primary-600' : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Job Profile */}
      {step === 1 && (
        <div className="card max-w-2xl">
          <h2 className="text-lg font-semibold mb-4">Step 1: Define Job Profile</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Job Title *
              </label>
              <input
                type="text"
                value={jobProfile.title}
                onChange={(e) => setJobProfile({ ...jobProfile, title: e.target.value })}
                className="input"
                placeholder="e.g., Senior Software Engineer"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Experience Level
              </label>
              <select
                value={jobProfile.experience}
                onChange={(e) => setJobProfile({ ...jobProfile, experience: e.target.value })}
                className="input"
              >
                <option value="0-1 years">0-1 years (Entry Level)</option>
                <option value="1-3 years">1-3 years (Junior)</option>
                <option value="3-5 years">3-5 years (Mid-Level)</option>
                <option value="5+ years">5+ years (Senior)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Job Description (Optional)
              </label>
              <textarea
                value={jobProfile.description}
                onChange={(e) => setJobProfile({ ...jobProfile, description: e.target.value })}
                className="input min-h-[120px]"
                rows={5}
                placeholder="Paste the job description to help AI understand requirements better..."
              />
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={handleAnalyzeJob}
                disabled={analyzing || !jobProfile.title.trim()}
                className="btn btn-primary"
              >
                {analyzing ? 'Analyzing...' : 'Analyze & Continue'}
              </button>
              <button
                onClick={() => setStep(2)}
                className="btn btn-secondary"
              >
                Skip Analysis
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Skills and Settings */}
      {step === 2 && (
        <div className="card max-w-2xl">
          <h2 className="text-lg font-semibold mb-4">Step 2: Skills & Test Settings</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Required Skills *
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addSkill();
                    }
                  }}
                  className="input flex-1"
                  placeholder="Type a skill and press Enter"
                />
                <button
                  type="button"
                  onClick={addSkill}
                  className="btn btn-secondary"
                >
                  Add
                </button>
              </div>
              {skills.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {skills.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-primary-100 text-primary-800 rounded-full text-sm"
                    >
                      {skill}
                      <button
                        type="button"
                        onClick={() => removeSkill(skill)}
                        className="text-primary-600 hover:text-primary-800"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Difficulty Level
              </label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
                className="input"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
                <option value="mixed">Mixed (All Levels)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Number of MCQ Questions
                </label>
                <input
                  type="number"
                  value={mcqCount}
                  onChange={(e) => setMcqCount(Math.max(0, parseInt(e.target.value) || 0))}
                  className="input"
                  min={0}
                  max={50}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Number of Coding Questions
                </label>
                <input
                  type="number"
                  value={codingCount}
                  onChange={(e) => setCodingCount(Math.max(0, parseInt(e.target.value) || 0))}
                  className="input"
                  min={0}
                  max={10}
                />
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => setStep(1)}
                className="btn btn-secondary"
              >
                Back
              </button>
              <button
                onClick={handleGenerateTest}
                disabled={loading || skills.length === 0}
                className="btn btn-primary"
              >
                {loading ? 'Generating...' : 'Generate Test'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Review Selection */}
      {step === 3 && selection && (
        <div className="card max-w-3xl">
          <h2 className="text-lg font-semibold mb-4">Step 3: Review AI Selection</h2>

          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="font-medium mb-2">AI Reasoning</h3>
              <p className="text-gray-600 text-sm">{selection.reasoning}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 rounded-lg p-4">
                <h3 className="font-medium text-blue-800">MCQ Questions</h3>
                <p className="text-3xl font-bold text-blue-600">
                  {selection.mcqQuestionIds.length}
                </p>
                <p className="text-sm text-blue-600">selected</p>
              </div>
              <div className="bg-green-50 rounded-lg p-4">
                <h3 className="font-medium text-green-800">Coding Questions</h3>
                <p className="text-3xl font-bold text-green-600">
                  {selection.codingQuestionIds.length}
                </p>
                <p className="text-sm text-green-600">selected</p>
              </div>
            </div>

            <div className="bg-yellow-50 rounded-lg p-4">
              <h3 className="font-medium text-yellow-800">Suggested Settings</h3>
              <div className="grid grid-cols-3 gap-4 mt-2 text-sm">
                <div>
                  <span className="text-yellow-600">Duration:</span>{' '}
                  <span className="font-medium">{selection.suggestedDuration} min</span>
                </div>
                <div className="col-span-2">
                  <span className="text-yellow-600">Test Name:</span>{' '}
                  <span className="font-medium">{selection.suggestedTestName}</span>
                </div>
              </div>
            </div>

            {(selection.mcqQuestionIds.length < mcqCount ||
              selection.codingQuestionIds.length < codingCount) && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <p className="text-orange-800 text-sm">
                  Note: Fewer questions were selected than requested because not enough
                  matching questions were found in the library. Consider adding more
                  questions with relevant tags.
                </p>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <button onClick={() => setStep(2)} className="btn btn-secondary">
                Back
              </button>
              <button onClick={() => setStep(4)} className="btn btn-primary">
                Continue to Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Test Settings */}
      {step === 4 && (
        <div className="card max-w-2xl">
          <h2 className="text-lg font-semibold mb-4">Step 4: Finalize Test Settings</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Test Name *
              </label>
              <input
                type="text"
                value={testSettings.name}
                onChange={(e) => setTestSettings({ ...testSettings, name: e.target.value })}
                className="input"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={testSettings.description}
                onChange={(e) => setTestSettings({ ...testSettings, description: e.target.value })}
                className="input"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Duration (minutes) *
                </label>
                <input
                  type="number"
                  value={testSettings.duration}
                  onChange={(e) => setTestSettings({ ...testSettings, duration: parseInt(e.target.value) || 60 })}
                  className="input"
                  min={5}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Passing Marks
                </label>
                <input
                  type="number"
                  value={testSettings.passingMarks}
                  onChange={(e) => setTestSettings({ ...testSettings, passingMarks: parseInt(e.target.value) || 0 })}
                  className="input"
                  min={0}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start Time *
                </label>
                <input
                  type="datetime-local"
                  value={testSettings.startTime}
                  onChange={(e) => setTestSettings({ ...testSettings, startTime: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  End Time (Optional)
                </label>
                <input
                  type="datetime-local"
                  value={testSettings.endTime}
                  onChange={(e) => setTestSettings({ ...testSettings, endTime: e.target.value })}
                  className="input"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Negative Marking (per question)
                </label>
                <input
                  type="number"
                  value={testSettings.negativeMarking}
                  onChange={(e) => setTestSettings({ ...testSettings, negativeMarking: parseFloat(e.target.value) || 0 })}
                  className="input"
                  min={0}
                  step={0.25}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Violations
                </label>
                <input
                  type="number"
                  value={testSettings.maxViolations}
                  onChange={(e) => setTestSettings({ ...testSettings, maxViolations: parseInt(e.target.value) || 3 })}
                  className="input"
                  min={1}
                />
              </div>
            </div>

            <div className="flex gap-6">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={testSettings.shuffleQuestions}
                  onChange={(e) => setTestSettings({ ...testSettings, shuffleQuestions: e.target.checked })}
                  className="w-4 h-4"
                />
                Shuffle Questions
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={testSettings.shuffleOptions}
                  onChange={(e) => setTestSettings({ ...testSettings, shuffleOptions: e.target.checked })}
                  className="w-4 h-4"
                />
                Shuffle Options
              </label>
            </div>

            <div className="flex gap-3 pt-4">
              <button onClick={() => setStep(3)} className="btn btn-secondary">
                Back
              </button>
              <button
                onClick={handleCreateTest}
                disabled={loading || !testSettings.startTime || !testSettings.name}
                className="btn btn-primary"
              >
                {loading ? 'Creating...' : 'Create Test'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
