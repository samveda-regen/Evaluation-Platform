import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { format } from 'date-fns';

export default function TestForm() {
  const { testId } = useParams();
  const navigate = useNavigate();
  const isEditing = !!testId;

  const [loading, setLoading] = useState(false);
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
    requireIdVerification: false
  });

  useEffect(() => {
    if (isEditing) {
      loadTest();
    }
  }, [testId]);

  const loadTest = async () => {
    try {
      const { data } = await adminApi.getTest(testId!);
      const test = data.test;
      setFormData({
        name: test.name,
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
        requireIdVerification: test.requireIdVerification || false
      });
    } catch (error) {
      toast.error('Failed to load test');
      navigate('/admin/tests');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const data = {
        ...formData,
        endTime: formData.endTime || undefined
      };

      if (isEditing) {
        await adminApi.updateTest(testId!, data);
        toast.success('Test updated successfully');
      } else {
        const response = await adminApi.createTest(data);
        toast.success(`Test created! Code: ${response.data.test.testCode}`);
      }
      navigate('/admin/tests');
    } catch (error: unknown) {
      const err = error as {
        response?: {
          data?: {
            error?: string;
            errors?: Array<{ msg?: string }>;
          };
        };
        message?: string;
      };
      const validationMessage = err.response?.data?.errors?.[0]?.msg;
      toast.error(validationMessage || err.response?.data?.error || err.message || 'Failed to save test');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked :
              type === 'number' ? Number(value) : value
    }));
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">
        {isEditing ? 'Edit Test' : 'Create New Test'}
      </h1>

      <form onSubmit={handleSubmit} className="card max-w-3xl">
        <div className="space-y-6">
          {/* Basic Info */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Test Name *
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="input"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              className="input min-h-[80px]"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Instructions for Candidates
            </label>
            <textarea
              name="instructions"
              value={formData.instructions}
              onChange={handleChange}
              className="input min-h-[120px]"
              rows={5}
              placeholder="Enter test rules and instructions..."
            />
          </div>

          {/* Time Settings */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Duration (minutes) *
              </label>
              <input
                type="number"
                name="duration"
                value={formData.duration}
                onChange={handleChange}
                className="input"
                min={1}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Violations *
              </label>
              <input
                type="number"
                name="maxViolations"
                value={formData.maxViolations}
                onChange={handleChange}
                className="input"
                min={1}
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
                name="startTime"
                value={formData.startTime}
                onChange={handleChange}
                className="input"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Time (Optional)
              </label>
              <input
                type="datetime-local"
                name="endTime"
                value={formData.endTime}
                onChange={handleChange}
                className="input"
              />
            </div>
          </div>

          {/* Marks Settings */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Total Marks *
              </label>
              <input
                type="number"
                name="totalMarks"
                value={formData.totalMarks}
                onChange={handleChange}
                className="input"
                min={1}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Passing Marks
              </label>
              <input
                type="number"
                name="passingMarks"
                value={formData.passingMarks}
                onChange={handleChange}
                className="input"
                min={0}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Negative Marking
              </label>
              <input
                type="number"
                name="negativeMarking"
                value={formData.negativeMarking}
                onChange={handleChange}
                className="input"
                min={0}
                step={0.25}
              />
            </div>
          </div>

          {/* Options */}
          <div className="space-y-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="proctorEnabled"
                checked={formData.proctorEnabled}
                onChange={handleChange}
                className="w-4 h-4"
              />
              <span>Enable live AI proctoring</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="requireCamera"
                checked={formData.requireCamera}
                onChange={handleChange}
                className="w-4 h-4"
                disabled={!formData.proctorEnabled}
              />
              <span>Require camera access</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="requireMicrophone"
                checked={formData.requireMicrophone}
                onChange={handleChange}
                className="w-4 h-4"
                disabled={!formData.proctorEnabled}
              />
              <span>Require microphone access</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="requireScreenShare"
                checked={formData.requireScreenShare}
                onChange={handleChange}
                className="w-4 h-4"
                disabled={!formData.proctorEnabled}
              />
              <span>Require screen share</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="requireIdVerification"
                checked={formData.requireIdVerification}
                onChange={handleChange}
                className="w-4 h-4"
              />
              <span>Require ID verification before test</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="shuffleQuestions"
                checked={formData.shuffleQuestions}
                onChange={handleChange}
                className="w-4 h-4"
              />
              <span>Shuffle questions for each candidate</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="shuffleOptions"
                checked={formData.shuffleOptions}
                onChange={handleChange}
                className="w-4 h-4"
              />
              <span>Shuffle MCQ options</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="allowMultipleAttempts"
                checked={formData.allowMultipleAttempts}
                onChange={handleChange}
                className="w-4 h-4"
              />
              <span>Allow multiple attempts</span>
            </label>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
            >
              {loading ? 'Saving...' : isEditing ? 'Update Test' : 'Create Test'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/admin/tests')}
              className="btn btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
