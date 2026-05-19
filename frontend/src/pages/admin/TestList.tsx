import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { Test, Pagination } from '../../types';
import { format } from 'date-fns';
import { useAuthStore } from '../../context/authStore';

interface InvitationSummary {
  total: number;
  sent: number;
  failed: number;
}

export default function TestList() {
  const admin = useAuthStore((state) => state.admin);
  const navigate = useNavigate();
  const [tests, setTests] = useState<Test[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedTestForInvites, setSelectedTestForInvites] = useState<Test | null>(null);
  const [invitationFile, setInvitationFile] = useState<File | null>(null);
  const [customMessage, setCustomMessage] = useState('');
  const [sendingInvitations, setSendingInvitations] = useState(false);
  const [invitationSummary, setInvitationSummary] = useState<InvitationSummary | null>(null);
  const latestRequestIdRef = useRef(0);
  const hasLoadedTestsRef = useRef(false);
  const ownerLabel = admin?.name || admin?.email || 'Admin';

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const nextSearch = searchInput.trim();
      setPage(1);
      setAppliedSearch(nextSearch);
    }, 350);

    return () => clearTimeout(timeoutId);
  }, [searchInput]);

  useEffect(() => {
    loadTests();
  }, [page, appliedSearch]);

  const loadTests = async () => {
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;

    if (!hasLoadedTestsRef.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const { data } = await adminApi.getTests(page, 10, appliedSearch);
      if (latestRequestIdRef.current !== requestId) return;

      hasLoadedTestsRef.current = true;
      setTests(data.tests);
      setPagination(data.pagination);
      setSelectedTestIds((prev) => {
        const next = new Set<string>();
        data.tests.forEach((test: Test) => {
          if (prev.has(test.id)) {
            next.add(test.id);
          }
        });
        return next;
      });
    } catch (error) {
      if (latestRequestIdRef.current === requestId) {
        toast.error('Failed to load tests');
      }
    } finally {
      if (latestRequestIdRef.current === requestId) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  const resetFilters = () => {
    setSearchInput('');
    setAppliedSearch('');
    setPage(1);
  };

  const allSelected = tests.length > 0 && tests.every((test) => selectedTestIds.has(test.id));

  const toggleSelectAll = () => {
    setSelectedTestIds(() => {
      if (allSelected) {
        return new Set<string>();
      }
      return new Set<string>(tests.map((test) => test.id));
    });
  };

  const toggleSelectTest = (testId: string) => {
    setSelectedTestIds((prev) => {
      const next = new Set(prev);
      if (next.has(testId)) {
        next.delete(testId);
      } else {
        next.add(testId);
      }
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (selectedTestIds.size === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${selectedTestIds.size} selected test${selectedTestIds.size > 1 ? 's' : ''}? This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }

    setBulkDeleting(true);
    const idsToDelete = Array.from(selectedTestIds);

    try {
      const results = await Promise.allSettled(idsToDelete.map((testId) => adminApi.deleteTest(testId)));
      const successIds = idsToDelete.filter((_, index) => results[index].status === 'fulfilled');
      const failedCount = idsToDelete.length - successIds.length;

      if (successIds.length > 0) {
        const successSet = new Set(successIds);
        setTests((prev) => prev.filter((test) => !successSet.has(test.id)));
        setSelectedTestIds((prev) => {
          const next = new Set(prev);
          successIds.forEach((id) => next.delete(id));
          return next;
        });
      }

      if (failedCount === 0) {
        toast.success(`Deleted ${successIds.length} test${successIds.length > 1 ? 's' : ''}`);
      } else if (successIds.length === 0) {
        toast.error('Unable to delete selected test(s). Some tests may have dependencies.');
      } else {
        toast.success(`Deleted ${successIds.length} test(s). ${failedCount} could not be deleted.`);
      }

      await loadTests();
    } finally {
      setBulkDeleting(false);
    }
  };

  const escapeCsvValue = (value: string | number | null | undefined) => {
    const stringValue = value === null || value === undefined ? '' : String(value);
    return `"${stringValue.replace(/"/g, '""')}"`;
  };

  const downloadCsv = (rows: Test[]) => {
    const headers = [
      'Test Name',
      'Description',
      'Questions',
      'Duration (minutes)',
      'Owner',
      'Start Date',
      'Status',
      'Not Attempted',
      'Completed',
      'To Evaluate',
    ];

    const csvRows = rows.map((test) => [
      test.name,
      test.description?.trim() || 'General',
      test._count?.questions || 0,
      test.duration,
      ownerLabel,
      format(new Date(test.startTime), 'yyyy/MM/dd'),
      test.isActive ? 'Active' : 'Draft',
      0,
      test._count?.attempts || 0,
      0,
    ]);

    const csvContent = [headers, ...csvRows]
      .map((row) => row.map(escapeCsvValue).join(','))
      .join('\n');
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tests-export-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportTests = async () => {
    setExporting(true);
    try {
      const limit = 100;
      const { data } = await adminApi.getTests(1, limit, appliedSearch);
      let testsToExport: Test[] = data.tests || [];
      const totalPages = data.pagination?.totalPages || 1;

      for (let nextPage = 2; nextPage <= totalPages; nextPage += 1) {
        const pageResponse = await adminApi.getTests(nextPage, limit, appliedSearch);
        testsToExport = [...testsToExport, ...(pageResponse.data.tests || [])];
      }

      if (testsToExport.length === 0) {
        toast.error('No tests available to export');
        return;
      }

      downloadCsv(testsToExport);
      toast.success('Tests exported successfully');
    } catch (error) {
      toast.error('Failed to export tests');
    } finally {
      setExporting(false);
    }
  };

  const openInvitationModal = (test: Test) => {
    setSelectedTestForInvites(test);
    setInvitationFile(null);
    setCustomMessage('');
    setInvitationSummary(null);
  };

  const closeInvitationModal = () => {
    if (sendingInvitations) {
      return;
    }

    setSelectedTestForInvites(null);
    setInvitationFile(null);
    setCustomMessage('');
    setInvitationSummary(null);
  };

  const handleSendInvitations = async () => {
    if (!selectedTestForInvites) {
      return;
    }

    if (!invitationFile) {
      toast.error('Please upload a CSV or XLSX file');
      return;
    }

    const formData = new FormData();
    formData.append('file', invitationFile);
    if (customMessage.trim()) {
      formData.append('customMessage', customMessage.trim());
    }

    setSendingInvitations(true);
    setInvitationSummary(null);

    try {
      const { data } = await adminApi.sendInvitations(selectedTestForInvites.id, formData);
      setInvitationSummary(data);
      if (data.failed > 0 && data.sent > 0) {
        toast.success(`Invitation batch completed with partial failures (${data.sent} sent, ${data.failed} failed)`);
      } else {
        toast.success('Invitation batch completed');
      }
    } catch (error: unknown) {
      const typedError = error as { response?: { data?: { error?: string } } };
      toast.error(typedError.response?.data?.error || 'Failed to send invitations');
    } finally {
      setSendingInvitations(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-sm text-slate-500">
        <span className="text-slate-700">Tests</span>
        <span className="mx-2">›</span>
        <span>Active</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold text-slate-900">Tests</h1>
        <div className="flex flex-wrap items-center gap-3">
          {selectedTestIds.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              disabled={bulkDeleting}
              className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
            >
              {bulkDeleting ? 'Deleting...' : `Delete Selected (${selectedTestIds.size})`}
            </button>
          )}
          <button
            onClick={handleExportTests}
            disabled={exporting}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3v10m0 0l4-4m-4 4l-4-4M5 15v2a2 2 0 002 2h10a2 2 0 002-2v-2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {exporting ? 'Exporting...' : 'Export'}
          </button>
          <Link
            to="/admin/tests/agent"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            AI Generate Test
          </Link>
          <Link
            to="/admin/tests/new"
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            Create Test
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-6 border-b border-slate-200 text-sm">
        <button className="relative pb-3 font-semibold text-slate-900 after:absolute after:-bottom-[1px] after:left-0 after:h-[3px] after:w-full after:bg-emerald-500">
          Active Tests
        </button>
        <button className="pb-3 text-slate-500">Archived Tests</button>
        <button className="pb-3 text-slate-500">Starred Tests</button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600"></div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-[280px,1fr] gap-6">
            <aside className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-500">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M4 6h16M7 12h10M10 18h4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  Filters
                </div>
                <button
                  onClick={resetFilters}
                  disabled={!searchInput && !appliedSearch}
                  className="text-xs font-semibold text-emerald-600 hover:text-emerald-500 disabled:cursor-not-allowed disabled:text-slate-500"
                >
                  Reset all
                </button>
              </div>

              <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Search test</label>
                  {refreshing && <span className="text-[11px] font-medium text-emerald-500">Updating...</span>}
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-500/20">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M21 21l-4.3-4.3m1.3-5.2a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                    placeholder="Search for a test.."
                  />
                  {searchInput && (
                    <button
                      onClick={resetFilters}
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-label="Clear search"
                    >
                      <span aria-hidden="true" className="text-lg leading-none">&times;</span>
                    </button>
                  )}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Searches test name, description, and code.
                </p>
              </div>
            </aside>

            <section className={`rounded-2xl border border-slate-200 bg-white transition-opacity ${refreshing ? 'opacity-70' : 'opacity-100'}`}>
              <div className="grid grid-cols-[minmax(320px,1fr)_110px_110px_110px_44px] gap-4 border-b border-slate-200 px-5 py-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-slate-300"
                    aria-label="Select all tests"
                  />
                  <span>Tests</span>
                </span>
                <span className="text-center">Not Attempted</span>
                <span className="text-center">Completed</span>
                <span className="text-center">To Evaluate</span>
                <span />
              </div>

              <div>
                {tests.length === 0 ? (
                  <div className="px-6 py-14 text-center">
                    <p className="text-sm text-slate-500">
                      {appliedSearch ? 'No tests match your search.' : 'No tests created yet.'}
                    </p>
                    {appliedSearch ? (
                      <button
                        onClick={resetFilters}
                        className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Reset all
                      </button>
                    ) : (
                      <Link to="/admin/tests/new" className="btn btn-primary mt-4 inline-flex">
                        Create your first test
                      </Link>
                    )}
                  </div>
                ) : tests.map((test) => (
                  <div
                    key={test.id}
                    onClick={() => navigate(`/admin/tests/${test.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(`/admin/tests/${test.id}`);
                      }
                    }}
                    className="grid cursor-pointer grid-cols-[minmax(320px,1fr)_110px_110px_110px_44px] gap-4 border-b border-slate-200 px-5 py-5 text-sm transition hover:bg-slate-50 last:border-b-0"
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedTestIds.has(test.id)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        onChange={() => toggleSelectTest(test.id)}
                        className="mt-1 h-4 w-4 rounded border-slate-300"
                        aria-label={`Select ${test.name}`}
                      />
                      <button
                        onClick={(event) => event.stopPropagation()}
                        className="mt-1 text-slate-300 transition hover:text-amber-400"
                        aria-label="Star test"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M12 4l2.6 5.3 5.9.9-4.3 4.2 1 5.9-5.2-2.7-5.2 2.7 1-5.9-4.3-4.2 5.9-.9L12 4z"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={`/admin/tests/${test.id}`}
                            className="font-semibold text-slate-900 hover:text-emerald-700"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {test.name}
                          </Link>
                          {!test.isActive && (
                            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                              Draft
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-500">
                          {test.description?.trim() ? test.description : 'General'}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
                          <span className="inline-flex items-center gap-1">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                              <path
                                d="M7 7h10M7 12h10M7 17h6"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                              />
                            </svg>
                            {test._count?.questions || 0}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                              <path
                                d="M12 6v6l4 2"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
                            </svg>
                            {test.duration}m
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                              <path
                                d="M8 7a4 4 0 118 0 4 4 0 01-8 0zm-3 12a7 7 0 0114 0"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                              />
                            </svg>
                            {ownerLabel}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                              <path
                                d="M7 3v4M17 3v4M4 9h16M5 13h6"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                              />
                              <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.6" />
                            </svg>
                            {format(new Date(test.startTime), 'yyyy/MM/dd')}
                          </span>
                        </div>

                      </div>
                    </div>

                    <div className="text-center text-slate-600">0</div>
                    <div className="text-center text-slate-600">{test._count?.attempts || 0}</div>
                    <div className="text-center text-slate-600">0</div>
                    <div className="relative flex justify-end">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          openInvitationModal(test);
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50"
                        aria-label="Send Invitations"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M16 11a4 4 0 10-8 0 4 4 0 008 0zM3 20a7 7 0 0114 0"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                          />
                          <path
                            d="M19 8v6M16 11h6"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-6">
              <button
                onClick={() => setPage(page - 1)}
                disabled={page === 1}
                className="btn btn-secondary"
              >
                Previous
              </button>
              <span className="py-2 px-4">
                Page {page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page === pagination.totalPages}
                className="btn btn-secondary"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {selectedTestForInvites && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="card w-full max-w-2xl">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">Send Invitations</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Upload a CSV or XLSX file with <span className="font-mono">name,email</span> columns for{' '}
                  <span className="font-medium">{selectedTestForInvites.name}</span>.
                </p>
              </div>
              <button
                onClick={closeInvitationModal}
                disabled={sendingInvitations}
                className="text-[0px] leading-none text-gray-500 hover:text-gray-700"
                aria-label="Close"
              >
                <span aria-hidden="true" className="text-xl">&times;</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Candidate File
                </label>
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    setInvitationFile(file);
                  }}
                  className="input"
                  disabled={sendingInvitations}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Supported formats: CSV, XLSX
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Optional Custom Message
                </label>
                <textarea
                  value={customMessage}
                  onChange={(event) => setCustomMessage(event.target.value)}
                  rows={4}
                  className="input w-full"
                  placeholder="Add a custom note included in invitation emails..."
                  disabled={sendingInvitations}
                />
              </div>

              {sendingInvitations && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
                  Sending invitations in batches of 10. Please wait...
                </div>
              )}

              {invitationSummary && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                  Total: {invitationSummary.total} | Sent: {invitationSummary.sent} | Failed: {invitationSummary.failed}
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-6">
              <button
                type="button"
                onClick={handleSendInvitations}
                disabled={sendingInvitations}
                className="btn btn-primary"
              >
                {sendingInvitations ? 'Sending...' : 'Send Invitations'}
              </button>
              <button
                type="button"
                onClick={closeInvitationModal}
                disabled={sendingInvitations}
                className="btn btn-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
