import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';

type DocumentType = 'id_front' | 'id_back' | 'selfie' | 'face_reference';

interface IdDocumentRecord {
  fileId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  candidateId: string;
  candidateName: string;
  testCode: string;
  documentType: string;
  relativePath?: string;
}

const documentTypeOptions: Array<{ value: '' | DocumentType; label: string }> = [
  { value: '', label: 'All Types' },
  { value: 'id_front', label: 'ID Front' },
  { value: 'id_back', label: 'ID Back' },
  { value: 'selfie', label: 'Selfie' },
  { value: 'face_reference', label: 'Face Reference' },
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function IDVerificationData() {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<IdDocumentRecord[]>([]);
  const [search, setSearch] = useState('');
  const [candidateName, setCandidateName] = useState('');
  const [testCode, setTestCode] = useState('');
  const [documentType, setDocumentType] = useState<'' | DocumentType>('');
  const [selectedCandidateFolder, setSelectedCandidateFolder] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const loadItems = async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.getIdVerificationDocuments({
        search: search.trim() || undefined,
        candidateName: candidateName.trim() || undefined,
        testCode: testCode.trim() || undefined,
        documentType: documentType || undefined,
      });
      setItems(data.items || []);
      setSelectedIds(new Set());
    } catch (error) {
      toast.error('Failed to load ID verification files');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadItems();
  }, []);

  const folders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.candidateName, (counts.get(item.candidateName) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const visibleItems = useMemo(() => {
    if (selectedCandidateFolder === 'all') return items;
    return items.filter(item => item.candidateName === selectedCandidateFolder);
  }, [items, selectedCandidateFolder]);

  const allVisibleSelected =
    visibleItems.length > 0 && visibleItems.every(item => selectedIds.has(item.fileId));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        visibleItems.forEach(item => next.delete(item.fileId));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        visibleItems.forEach(item => next.add(item.fileId));
        return next;
      });
    }
  };

  const toggleSelect = (fileId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const handleDelete = async (fileId: string) => {
    const confirmed = window.confirm('Delete this ID file?');
    if (!confirmed) return;

    try {
      await adminApi.deleteIdVerificationDocument(fileId);
      setItems(prev => prev.filter(item => item.fileId !== fileId));
      setSelectedIds(prev => { const next = new Set(prev); next.delete(fileId); return next; });
      toast.success('ID file deleted');
    } catch (error) {
      toast.error('Failed to delete ID file');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = window.confirm(
      `Delete ${selectedIds.size} selected file${selectedIds.size > 1 ? 's' : ''}? This cannot be undone.`
    );
    if (!confirmed) return;

    setBulkDeleting(true);
    let successCount = 0;
    let failCount = 0;
    const toDelete = Array.from(selectedIds);

    for (const fileId of toDelete) {
      try {
        await adminApi.deleteIdVerificationDocument(fileId);
        successCount++;
      } catch {
        failCount++;
      }
    }

    setItems(prev => prev.filter(item => !toDelete.includes(item.fileId)));
    setSelectedIds(new Set());
    setBulkDeleting(false);

    if (failCount === 0) {
      toast.success(`Deleted ${successCount} file${successCount > 1 ? 's' : ''}`);
    } else {
      toast.error(`Deleted ${successCount}, failed ${failCount}`);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">ID Verification Data</h1>
        <p className="text-gray-600 mt-1">
          Explore uploaded candidate ID documents. You can view, save, and delete files.
        </p>
      </div>

      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by file/candidate/test"
            className="input"
          />
          <input
            type="text"
            value={candidateName}
            onChange={e => setCandidateName(e.target.value)}
            placeholder="Candidate name"
            className="input"
          />
          <input
            type="text"
            value={testCode}
            onChange={e => setTestCode(e.target.value)}
            placeholder="Test code"
            className="input"
          />
          <select
            value={documentType}
            onChange={e => setDocumentType(e.target.value as '' | DocumentType)}
            className="input"
          >
            {documentTypeOptions.map(option => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button onClick={loadItems} className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading...' : 'Apply Filters'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="card lg:col-span-1">
          <p className="text-sm font-semibold text-gray-700 mb-3">Folders</p>
          <div className="space-y-1">
            <button
              onClick={() => setSelectedCandidateFolder('all')}
              className={`w-full text-left px-3 py-2 rounded ${
                selectedCandidateFolder === 'all' ? 'bg-primary-50 text-primary-700' : 'hover:bg-gray-100'
              }`}
            >
              all ({items.length})
            </button>
            {folders.map(folder => (
              <button
                key={folder.name}
                onClick={() => setSelectedCandidateFolder(folder.name)}
                className={`w-full text-left px-3 py-2 rounded truncate ${
                  selectedCandidateFolder === folder.name
                    ? 'bg-primary-50 text-primary-700'
                    : 'hover:bg-gray-100'
                }`}
                title={folder.name}
              >
                {folder.name} ({folder.count})
              </button>
            ))}
          </div>
        </div>

        <div className="card lg:col-span-3 overflow-x-auto">
          {visibleItems.length === 0 ? (
            <p className="text-gray-500">No ID files found for current filters.</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-600">
                  {selectedIds.size > 0
                    ? `${selectedIds.size} selected`
                    : `${visibleItems.length} file${visibleItems.length !== 1 ? 's' : ''}`}
                </span>
                {selectedIds.size > 0 && (
                  <button
                    onClick={handleBulkDelete}
                    disabled={bulkDeleting}
                    className="btn text-xs bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {bulkDeleting ? 'Deleting...' : `Delete Selected (${selectedIds.size})`}
                  </button>
                )}
              </div>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-600">
                    <th className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                        title="Select all"
                      />
                    </th>
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Candidate</th>
                    <th className="py-2 pr-3">Test</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Size</th>
                    <th className="py-2 pr-3">Uploaded</th>
                    <th className="py-2 pr-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map(item => (
                    <tr
                      key={item.fileId}
                      className={`border-b align-top ${selectedIds.has(item.fileId) ? 'bg-blue-50' : ''}`}
                    >
                      <td className="py-2 pr-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.fileId)}
                          onChange={() => toggleSelect(item.fileId)}
                        />
                      </td>
                      <td className="py-2 pr-3 max-w-xs">
                        <p className="font-medium truncate" title={item.filename}>
                          {item.filename}
                        </p>
                        <p className="text-xs text-gray-500 truncate" title={item.relativePath || ''}>
                          {item.relativePath || item.originalName}
                        </p>
                      </td>
                      <td className="py-2 pr-3">{item.candidateName}</td>
                      <td className="py-2 pr-3">{item.testCode}</td>
                      <td className="py-2 pr-3">{item.documentType}</td>
                      <td className="py-2 pr-3">{formatSize(item.fileSize)}</td>
                      <td className="py-2 pr-3">{formatDate(item.createdAt)}</td>
                      <td className="py-2 pr-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => window.open(`/api/files/${item.fileId}`, '_blank')}
                            className="btn btn-secondary text-xs"
                          >
                            View
                          </button>
                          <a
                            href={`/api/files/${item.fileId}/download`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-secondary text-xs"
                          >
                            Save
                          </a>
                          <button
                            onClick={() => handleDelete(item.fileId)}
                            className="btn text-xs bg-red-600 text-white hover:bg-red-700"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
