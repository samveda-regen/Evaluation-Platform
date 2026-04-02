import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';

interface MediaAsset {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  storageUrl: string;
  mediaType: 'image' | 'video' | 'audio';
  width?: number;
  height?: number;
  duration?: number;
  thumbnailUrl?: string;
}

export default function MCQForm() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    questionText: '',
    options: ['', '', '', ''],
    correctAnswers: [] as number[],
    marks: 5,
    isMultipleChoice: false,
    explanation: '',
    difficulty: 'medium',
    topic: '',
    tags: [] as string[]
  });
  const [tagInput, setTagInput] = useState('');
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadingMedia(true);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // Validate file type
        const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/ogg'];
        if (!validTypes.includes(file.type)) {
          toast.error(`Invalid file type: ${file.name}`);
          continue;
        }

        // Validate file size (10MB for images, 100MB for videos, 50MB for audio)
        const maxSize = file.type.startsWith('image/') ? 10 * 1024 * 1024 :
                       file.type.startsWith('video/') ? 100 * 1024 * 1024 :
                       50 * 1024 * 1024;

        if (file.size > maxSize) {
          toast.error(`File too large: ${file.name}`);
          continue;
        }

        // Convert to base64
        const reader = new FileReader();
        const base64Data = await new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            // Remove data:image/jpeg;base64, prefix
            const base64 = result.split(',')[1];
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // Get image/video dimensions if applicable
        let width, height, duration;
        if (file.type.startsWith('image/')) {
          const img = await loadImage(file);
          width = img.width;
          height = img.height;
        } else if (file.type.startsWith('video/')) {
          const video = await loadVideo(file);
          width = video.videoWidth;
          height = video.videoHeight;
          duration = Math.floor(video.duration);
        }

        // Upload to server
        const uploadData = {
          file: {
            data: base64Data,
            mimeType: file.type,
            originalName: file.name,
            width,
            height,
            duration
          }
        };

        const { data } = await adminApi.uploadMedia(uploadData);

        if (data.success && data.asset) {
          setMediaAssets(prev => [...prev, data.asset]);
          toast.success(`Uploaded ${file.name}`);
        }
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to upload media');
    } finally {
      setUploadingMedia(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const loadImage = (file: File): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  };

  const loadVideo = (file: File): Promise<HTMLVideoElement> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.onloadedmetadata = () => resolve(video);
      video.onerror = reject;
      video.src = URL.createObjectURL(file);
    });
  };

  const handleDeleteMedia = async (assetId: string) => {
    if (!confirm('Are you sure you want to delete this media?')) return;

    try {
      await adminApi.deleteMedia(assetId);
      setMediaAssets(prev => prev.filter(a => a.id !== assetId));
      toast.success('Media deleted');
    } catch (error) {
      toast.error('Failed to delete media');
    }
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !formData.tags.includes(tag)) {
      setFormData({ ...formData, tags: [...formData.tags, tag] });
      setTagInput('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    setFormData({
      ...formData,
      tags: formData.tags.filter((t) => t !== tagToRemove)
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate
    const nonEmptyOptions = formData.options.filter((o) => o.trim() !== '');
    if (nonEmptyOptions.length < 2) {
      toast.error('At least 2 options are required');
      return;
    }

    if (formData.correctAnswers.length === 0) {
      toast.error('Please select at least one correct answer');
      return;
    }

    setLoading(true);

    try {
      const data = {
        ...formData,
        options: nonEmptyOptions
      };

      const createResponse = await adminApi.createMCQ(data);
      const createdQuestionId: string | undefined = createResponse?.data?.question?.id;

      // If media was uploaded before question existed, attach it now.
      if (createdQuestionId && mediaAssets.length > 0) {
        const assetIds = mediaAssets.map(asset => asset.id);
        await adminApi.assignMediaToQuestion(createdQuestionId, assetIds);
      }

      toast.success('Question created');
      navigate('/admin/repository/custom');
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to save question');
    } finally {
      setLoading(false);
    }
  };

  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...formData.options];
    newOptions[index] = value;
    setFormData({ ...formData, options: newOptions });
  };

  const addOption = () => {
    if (formData.options.length < 6) {
      setFormData({ ...formData, options: [...formData.options, ''] });
    }
  };

  const removeOption = (index: number) => {
    if (formData.options.length > 2) {
      const newOptions = formData.options.filter((_, i) => i !== index);
      const newCorrectAnswers = formData.correctAnswers
        .filter((i) => i !== index)
        .map((i) => (i > index ? i - 1 : i));
      setFormData({
        ...formData,
        options: newOptions,
        correctAnswers: newCorrectAnswers
      });
    }
  };

  const toggleCorrectAnswer = (index: number) => {
    if (formData.isMultipleChoice) {
      const newCorrectAnswers = formData.correctAnswers.includes(index)
        ? formData.correctAnswers.filter((i) => i !== index)
        : [...formData.correctAnswers, index];
      setFormData({ ...formData, correctAnswers: newCorrectAnswers });
    } else {
      setFormData({ ...formData, correctAnswers: [index] });
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Create MCQ Question</h1>

      <form onSubmit={handleSubmit} className="card max-w-3xl">
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Question Text *
            </label>
            <textarea
              value={formData.questionText}
              onChange={(e) =>
                setFormData({ ...formData, questionText: e.target.value })
              }
              className="input min-h-[100px]"
              rows={4}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Marks *
              </label>
              <input
                type="number"
                value={formData.marks}
                onChange={(e) =>
                  setFormData({ ...formData, marks: Number(e.target.value) })
                }
                className="input"
                min={1}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Difficulty *
              </label>
              <select
                value={formData.difficulty}
                onChange={(e) =>
                  setFormData({ ...formData, difficulty: e.target.value })
                }
                className="input"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Topic (Optional)
              </label>
              <input
                type="text"
                value={formData.topic}
                onChange={(e) =>
                  setFormData({ ...formData, topic: e.target.value })
                }
                className="input"
                placeholder="e.g., Data Structures, Algorithms"
              />
            </div>

            <div className="flex items-center pt-6">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.isMultipleChoice}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      isMultipleChoice: e.target.checked,
                      correctAnswers: e.target.checked
                        ? formData.correctAnswers
                        : formData.correctAnswers.slice(0, 1)
                    })
                  }
                  className="w-4 h-4"
                />
                <span>Multiple correct answers</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Skills/Tags (Optional)
            </label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                className="input flex-1"
                placeholder="Type a skill/tag and press Enter"
              />
              <button
                type="button"
                onClick={addTag}
                className="btn btn-secondary"
              >
                Add
              </button>
            </div>
            {formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formData.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-primary-100 text-primary-800 rounded-full text-sm"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="text-primary-600 hover:text-primary-800"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Media Upload Section */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Media Attachments (Images, Videos, Audio)
              </label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingMedia}
                className="text-sm text-primary-600 hover:underline flex items-center gap-1"
              >
                <span className="text-lg">+</span> Upload More
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,audio/*"
              onChange={handleFileSelect}
              className="hidden"
            />

            {uploadingMedia && (
              <div className="text-sm text-gray-500 mb-3">Uploading...</div>
            )}

            {mediaAssets.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {mediaAssets.map((asset) => (
                  <div
                    key={asset.id}
                    className="relative border rounded-lg overflow-hidden bg-gray-50"
                  >
                    {/* Media Preview */}
                    <div className="aspect-video bg-gray-200 flex items-center justify-center">
                      {asset.mediaType === 'image' && (
                        <img
                          src={asset.storageUrl}
                          alt={asset.originalName}
                          className="w-full h-full object-cover"
                        />
                      )}
                      {asset.mediaType === 'video' && (
                        <video
                          src={asset.storageUrl}
                          controls
                          className="w-full h-full object-cover"
                        />
                      )}
                      {asset.mediaType === 'audio' && (
                        <div className="p-4 w-full">
                          <div className="text-center mb-2 text-sm text-gray-600">
                            🎵 Audio File
                          </div>
                          <audio
                            src={asset.storageUrl}
                            controls
                            className="w-full"
                          />
                        </div>
                      )}
                    </div>

                    {/* File Info */}
                    <div className="p-2 bg-white">
                      <p className="text-xs text-gray-600 truncate" title={asset.originalName}>
                        {asset.originalName}
                      </p>
                      <p className="text-xs text-gray-400">
                        {(asset.fileSize / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>

                    {/* Delete Button */}
                    <button
                      type="button"
                      onClick={() => handleDeleteMedia(asset.id)}
                      className="absolute top-2 right-2 bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-700 transition-colors"
                      title="Delete media"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary-500 hover:bg-primary-50 transition-colors"
              >
                <div className="text-gray-400 mb-2">
                  <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <p className="text-sm text-gray-500">
                  Click to upload images, videos, or audio files
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Images (10MB max), Videos (100MB max), Audio (50MB max)
                </p>
              </div>
            )}
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Options * (Select correct answers)
              </label>
              {formData.options.length < 6 && (
                <button
                  type="button"
                  onClick={addOption}
                  className="text-sm text-primary-600 hover:underline"
                >
                  + Add Option
                </button>
              )}
            </div>

            <div className="space-y-3">
              {formData.options.map((option, index) => (
                <div key={index} className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => toggleCorrectAnswer(index)}
                    className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-colors ${
                      formData.correctAnswers.includes(index)
                        ? 'bg-green-500 border-green-500 text-white'
                        : 'border-gray-300 hover:border-green-500'
                    }`}
                  >
                    {formData.correctAnswers.includes(index) ? '✓' : index + 1}
                  </button>
                  <input
                    type="text"
                    value={option}
                    onChange={(e) => handleOptionChange(index, e.target.value)}
                    className="input flex-1"
                    placeholder={`Option ${index + 1}`}
                  />
                  {formData.options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOption(index)}
                      className="text-red-600 hover:text-red-800"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-500 mt-2">
              Click the circle to mark correct answer(s)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Explanation (Optional)
            </label>
            <textarea
              value={formData.explanation}
              onChange={(e) =>
                setFormData({ ...formData, explanation: e.target.value })
              }
              className="input min-h-[80px]"
              rows={3}
              placeholder="Explain why the answer is correct..."
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
            >
              {loading ? 'Saving...' : 'Create Question'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/admin/repository/custom')}
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
