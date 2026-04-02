/**
 * MediaUploader Component
 *
 * Upload and manage media assets (images, videos, audio) for MCQ questions
 */

import { useState, useRef, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import api from '../services/api';

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

interface MediaUploaderProps {
  questionId?: string;
  existingMedia?: MediaAsset[];
  onMediaChange?: (media: MediaAsset[]) => void;
  maxFiles?: number;
}

const ALLOWED_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  video: ['video/mp4', 'video/webm', 'video/ogg'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm'],
};

const MAX_SIZES = {
  image: 10 * 1024 * 1024, // 10MB
  video: 500 * 1024 * 1024, // 500MB
  audio: 50 * 1024 * 1024, // 50MB
};

export default function MediaUploader({
  questionId,
  existingMedia = [],
  onMediaChange,
  maxFiles = 5,
}: MediaUploaderProps) {
  const [media, setMedia] = useState<MediaAsset[]>(existingMedia);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const getMediaType = (mimeType: string): 'image' | 'video' | 'audio' | null => {
    if (ALLOWED_TYPES.image.includes(mimeType)) return 'image';
    if (ALLOWED_TYPES.video.includes(mimeType)) return 'video';
    if (ALLOWED_TYPES.audio.includes(mimeType)) return 'audio';
    return null;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const validateFile = (file: File): string | null => {
    const mediaType = getMediaType(file.type);
    if (!mediaType) {
      return `File type ${file.type} is not supported`;
    }

    const maxSize = MAX_SIZES[mediaType];
    if (file.size > maxSize) {
      return `File too large. Max size for ${mediaType} is ${formatFileSize(maxSize)}`;
    }

    return null;
  };

  const uploadFile = async (file: File): Promise<MediaAsset | null> => {
    const validationError = validateFile(file);
    if (validationError) {
      toast.error(validationError);
      return null;
    }

    try {
      // Convert file to base64
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Get dimensions for images/videos
      let width: number | undefined;
      let height: number | undefined;
      let duration: number | undefined;

      if (file.type.startsWith('image/')) {
        const img = new Image();
        await new Promise<void>((resolve) => {
          img.onload = () => {
            width = img.width;
            height = img.height;
            resolve();
          };
          img.src = URL.createObjectURL(file);
        });
      } else if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
        const media = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
        await new Promise<void>((resolve) => {
          media.onloadedmetadata = () => {
            duration = Math.round(media.duration);
            if (file.type.startsWith('video/')) {
              width = (media as HTMLVideoElement).videoWidth;
              height = (media as HTMLVideoElement).videoHeight;
            }
            resolve();
          };
          media.src = URL.createObjectURL(file);
        });
      }

      // Upload to server
      const response = await api.post('/media/upload', {
        file: {
          data: base64,
          mimeType: file.type,
          originalName: file.name,
          width,
          height,
          duration,
        },
        questionId,
      });

      return response.data.asset;
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to upload file');
      return null;
    }
  };

  const handleFiles = useCallback(async (files: FileList) => {
    if (media.length + files.length > maxFiles) {
      toast.error(`Maximum ${maxFiles} files allowed`);
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    const totalFiles = files.length;
    let completed = 0;
    const newMedia: MediaAsset[] = [];

    for (const file of Array.from(files)) {
      const asset = await uploadFile(file);
      if (asset) {
        newMedia.push(asset);
      }
      completed++;
      setUploadProgress((completed / totalFiles) * 100);
    }

    const updatedMedia = [...media, ...newMedia];
    setMedia(updatedMedia);
    onMediaChange?.(updatedMedia);
    setUploading(false);
    setUploadProgress(0);

    if (newMedia.length > 0) {
      toast.success(`${newMedia.length} file(s) uploaded successfully`);
    }
  }, [media, maxFiles, questionId, onMediaChange]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleRemove = async (assetId: string) => {
    try {
      await api.delete(`/media/${assetId}`);
      const updatedMedia = media.filter(m => m.id !== assetId);
      setMedia(updatedMedia);
      onMediaChange?.(updatedMedia);
      toast.success('Media removed');
    } catch (error) {
      toast.error('Failed to remove media');
    }
  };

  const renderPreview = (asset: MediaAsset) => {
    switch (asset.mediaType) {
      case 'image':
        return (
          <img
            src={asset.storageUrl}
            alt={asset.originalName}
            className="w-full h-32 object-cover rounded"
          />
        );
      case 'video':
        return (
          <video
            src={asset.storageUrl}
            className="w-full h-32 object-cover rounded"
            controls
          />
        );
      case 'audio':
        return (
          <div className="w-full h-32 bg-gray-100 rounded flex items-center justify-center">
            <audio src={asset.storageUrl} controls className="w-full px-2" />
          </div>
        );
      default:
        return null;
    }
  };

  const getMediaIcon = (mediaType: string) => {
    switch (mediaType) {
      case 'image':
        return (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        );
      case 'video':
        return (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        );
      case 'audio':
        return (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload Area */}
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
          dragActive ? 'border-primary-500 bg-primary-50' : 'border-gray-300 hover:border-gray-400'
        } ${uploading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={[...ALLOWED_TYPES.image, ...ALLOWED_TYPES.video, ...ALLOWED_TYPES.audio].join(',')}
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
          className="hidden"
        />

        {uploading ? (
          <div className="space-y-2">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto" />
            <p className="text-sm text-gray-500">Uploading... {Math.round(uploadProgress)}%</p>
            <div className="w-48 mx-auto bg-gray-200 rounded-full h-2">
              <div
                className="bg-primary-600 h-2 rounded-full transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        ) : (
          <>
            <svg className="w-10 h-10 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="mt-2 text-sm text-gray-600">
              Drag & drop files here, or <span className="text-primary-600">browse</span>
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Images (max 10MB), Videos (max 500MB), Audio (max 50MB)
            </p>
          </>
        )}
      </div>

      {/* Media Grid */}
      {media.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {media.map((asset) => (
            <div key={asset.id} className="relative group border rounded-lg overflow-hidden">
              {renderPreview(asset)}

              {/* Overlay with info */}
              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(asset.id);
                  }}
                  className="bg-red-500 text-white p-2 rounded-full hover:bg-red-600"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>

              {/* File info */}
              <div className="p-2 bg-white border-t">
                <div className="flex items-center gap-1 text-gray-600">
                  {getMediaIcon(asset.mediaType)}
                  <span className="text-xs truncate flex-1" title={asset.originalName}>
                    {asset.originalName}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {formatFileSize(asset.fileSize)}
                  {asset.duration && ` | ${Math.floor(asset.duration / 60)}:${String(asset.duration % 60).padStart(2, '0')}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* File count info */}
      <p className="text-xs text-gray-400 text-right">
        {media.length} / {maxFiles} files
      </p>
    </div>
  );
}
