import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { format } from 'date-fns';
import { adminApi } from '../../services/api';
import { TestAttempt } from '../../types';

interface InvitationStats {
  invited: number;
  started: number;
  completed: number;
  notStarted: number;
  expired: number;
}

interface InvitationRow {
  id: string;
  name: string;
  email: string;
  inviteStatus: 'PENDING' | 'SENT' | 'FAILED';
  lifecycleStatus: 'Started' | 'Completed' | 'Not Started' | 'Expired';
  sentAt?: string | null;
  createdAt: string;
  consumedAt?: string | null;
}

interface InvitationDashboardResponse {
  test: { id: string; name: string };
  stats: InvitationStats;
  invitations: InvitationRow[];
}

interface TestInfo {
  id: string;
  name: string;
  testCode: string;
  totalMarks: number;
  passingMarks?: number;
}

interface TestCandidatesPanelProps {
  testId: string;
}

export default function TestCandidatesPanel({ testId }: TestCandidatesPanelProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [inviteStatusFilter, setInviteStatusFilter] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState('');
  const [selectedInviteId, setSelectedInviteId] = useState<string | null>(null);
  const [selectedInviteIds, setSelectedInviteIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [invitationData, setInvitationData] = useState<InvitationDashboardResponse | null>(null);
  const [invitationLoading, setInvitationLoading] = useState(true);

  const [test, setTest] = useState<TestInfo | null>(null);
  const [attempts, setAttempts] = useState<TestAttempt[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);

  useEffect(() => {
    loadInvitations();
  }, [testId]);

  useEffect(() => {
    loadResults();
  }, [testId]);

  const loadInvitations = async () => {
    if (!testId) return;
    setInvitationLoading(true);
    try {
      const { data } = await adminApi.getTestInvitations(testId);
      setInvitationData(data);
      setSelectedInviteIds((prev) => {
        const validIds = new Set<string>((data.invitations || []).map((invite: InvitationRow) => invite.id));
        const next = new Set<string>();
        prev.forEach((id) => {
          if (validIds.has(id)) {
            next.add(id);
          }
        });
        return next;
      });
    } catch (error) {
      toast.error('Failed to load candidate status');
    } finally {
      setInvitationLoading(false);
    }
  };

  const loadResults = async () => {
    if (!testId) return;
    setResultsLoading(true);
    try {
      const { data } = await adminApi.getTestResults(testId, 1, 50, '', false);
      setTest(data.test);
      setAttempts(data.attempts);
    } catch (error) {
      toast.error('Failed to load candidate results');
    } finally {
      setResultsLoading(false);
    }
  };

  const handleExport = async (formatType: 'csv' | 'json') => {
    try {
      const response = await adminApi.exportResults(testId, formatType);

      if (formatType === 'csv') {
        const blob = new Blob([response.data as BlobPart], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${test?.name ?? 'test'}_results.csv`;
        anchor.click();
        window.URL.revokeObjectURL(url);
      } else {
        const blob = new Blob([JSON.stringify(response.data, null, 2)], {
          type: 'application/json'
        });
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${test?.name ?? 'test'}_results.json`;
        anchor.click();
        window.URL.revokeObjectURL(url);
      }

      toast.success('Export downloaded');
    } catch (error) {
      toast.error('Failed to export results');
    }
  };

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredInvitations = invitationData?.invitations.filter((invite) => {
    const matchesSearch =
      !normalizedSearch ||
      invite.name.toLowerCase().includes(normalizedSearch) ||
      invite.email.toLowerCase().includes(normalizedSearch);
    const matchesInviteStatus = inviteStatusFilter ? invite.inviteStatus === inviteStatusFilter : true;
    const matchesLifecycle = lifecycleFilter ? invite.lifecycleStatus === lifecycleFilter : true;
    return matchesSearch && matchesInviteStatus && matchesLifecycle;
  }) ?? [];

  const filteredAttempts = attempts.filter((attempt) => {
    if (!normalizedSearch) return true;
    const name = attempt.candidate?.name?.toLowerCase() || '';
    const email = attempt.candidate?.email?.toLowerCase() || '';
    return name.includes(normalizedSearch) || email.includes(normalizedSearch);
  });

  const attemptByEmail = new Map<string, TestAttempt>();
  filteredAttempts.forEach((attempt) => {
    const email = attempt.candidate?.email?.toLowerCase();
    if (email) attemptByEmail.set(email, attempt);
  });

  const selectedInvite = selectedInviteId
    ? (invitationData?.invitations || []).find((invite) => invite.id === selectedInviteId) || null
    : null;
  const selectedAttempt = selectedInvite
    ? attemptByEmail.get(selectedInvite.email.toLowerCase()) || null
    : null;
  const allSelected =
    filteredInvitations.length > 0 &&
    filteredInvitations.every((invite) => selectedInviteIds.has(invite.id));

  const inviteDisplay = (invite: InvitationRow) => {
    if (invite.lifecycleStatus === 'Completed') return { label: 'Completed', tone: 'bg-emerald-50 text-emerald-700' };
    if (invite.lifecycleStatus === 'Started') return { label: 'Started', tone: 'bg-blue-50 text-blue-700' };
    if (invite.lifecycleStatus === 'Expired') return { label: 'Expired', tone: 'bg-rose-50 text-rose-700' };
    if (invite.inviteStatus === 'FAILED') return { label: 'Failed', tone: 'bg-rose-50 text-rose-700' };
    return { label: 'Invited', tone: 'bg-slate-100 text-slate-700' };
  };

  const handleReset = () => {
    setSearchTerm('');
    setInviteStatusFilter('');
    setLifecycleFilter('');
  };

  const handleRefresh = () => {
    loadInvitations();
    loadResults();
  };

  const toggleSelectAll = () => {
    setSelectedInviteIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        filteredInvitations.forEach((invite) => next.delete(invite.id));
      } else {
        filteredInvitations.forEach((invite) => next.add(invite.id));
      }
      return next;
    });
  };

  const toggleSelectInvite = (inviteId: string) => {
    setSelectedInviteIds((prev) => {
      const next = new Set(prev);
      if (next.has(inviteId)) {
        next.delete(inviteId);
      } else {
        next.add(inviteId);
      }
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (!testId || selectedInviteIds.size === 0) return;

    const confirmed = window.confirm(
      `Remove ${selectedInviteIds.size} selected candidate${selectedInviteIds.size > 1 ? 's' : ''} from this test?`
    );
    if (!confirmed) return;

    const idsToDelete = Array.from(selectedInviteIds);
    setBulkDeleting(true);

    try {
      const results = await Promise.allSettled(
        idsToDelete.map((invitationId) => adminApi.deleteTestInvitation(testId, invitationId))
      );

      const successIds = idsToDelete.filter((_, index) => results[index].status === 'fulfilled');
      const failedCount = idsToDelete.length - successIds.length;

      if (successIds.length > 0) {
        setSelectedInviteIds((prev) => {
          const next = new Set(prev);
          successIds.forEach((id) => next.delete(id));
          return next;
        });

        if (selectedInviteId && successIds.includes(selectedInviteId)) {
          setSelectedInviteId(null);
        }
      }

      if (failedCount === 0) {
        toast.success(`Removed ${successIds.length} candidate${successIds.length > 1 ? 's' : ''}`);
      } else if (successIds.length === 0) {
        toast.error('Failed to remove selected candidate(s)');
      } else {
        toast.success(`Removed ${successIds.length} candidate(s). ${failedCount} failed.`);
      }

      await Promise.all([loadInvitations(), loadResults()]);
    } finally {
      setBulkDeleting(false);
    }
  };

  const isLoading = invitationLoading || resultsLoading;
  const totalRows = filteredInvitations.length;

  return (
    <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
      <aside className="rounded-2xl border border-slate-200 bg-[#f7f9fd] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 6h16M7 12h10M10 18h4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            Filters
          </div>
          <button onClick={handleReset} className="text-xs font-semibold text-emerald-600 hover:underline">
            Reset all
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <details open className="rounded-xl border border-slate-200 bg-white">
            <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm font-medium text-slate-700">
              Candidate status
              <span className="text-slate-400">▾</span>
            </summary>
            <div className="space-y-3 px-3 pb-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Invite status</label>
                <select
                  value={inviteStatusFilter}
                  onChange={(event) => setInviteStatusFilter(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                >
                  <option value="">All</option>
                  <option value="SENT">Sent</option>
                  <option value="PENDING">Pending</option>
                  <option value="FAILED">Failed</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Lifecycle</label>
                <select
                  value={lifecycleFilter}
                  onChange={(event) => setLifecycleFilter(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                >
                  <option value="">All</option>
                  <option value="Started">Started</option>
                  <option value="Completed">Completed</option>
                  <option value="Not Started">Not Started</option>
                  <option value="Expired">Expired</option>
                </select>
              </div>
            </div>
          </details>

          {['Total score', 'Invited by', 'Invited on', 'Invitation expiry date', 'Completed on'].map((label) => (
            <div key={label} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
              <span>{label}</span>
              <span className="text-slate-400">▾</span>
            </div>
          ))}
        </div>

        <button className="mt-6 w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
          + Add filter
        </button>
      </aside>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-slate-400">
              <path
                d="M21 21l-4.3-4.3m1.3-5.2a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by candidate name or email"
              className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="flex items-center gap-2">
            {selectedInviteIds.size > 0 && (
              <button
                onClick={handleDeleteSelected}
                disabled={bulkDeleting || isLoading}
                className="inline-flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
              >
                {bulkDeleting ? 'Deleting...' : `Delete Selected (${selectedInviteIds.size})`}
              </button>
            )}
            <button
              onClick={handleRefresh}
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M20 12a8 8 0 11-2.3-5.7M20 4v6h-6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Refresh
            </button>
            <button
              onClick={() => handleExport('csv')}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
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
              Export
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white">
          <div className="grid grid-cols-[44px_minmax(200px,1fr)_140px_110px_140px_140px] items-center gap-3 border-b border-slate-200 bg-[#f7f9fd] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="h-4 w-4 rounded border-slate-300"
              aria-label="Select all candidates"
            />
            <div className="flex items-center gap-2">
              Candidate
              <span className="text-slate-300">⇅</span>
            </div>
            <span>Status</span>
            <div className="flex items-center gap-2">
              Score
              <span className="text-slate-300">⇅</span>
            </div>
            <span>Invited by</span>
            <div className="flex items-center gap-2">
              Invited on
              <span className="text-slate-300">⇅</span>
            </div>
          </div>

          {invitationLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
            </div>
          ) : filteredInvitations.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              {invitationData?.invitations.length ? 'No candidates match your filters.' : 'No invitations sent yet.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-200 text-sm">
              {filteredInvitations.map((invite) => {
                const attempt = attemptByEmail.get(invite.email.toLowerCase());
                const status = inviteDisplay(invite);
                const invitedOn = invite.sentAt || invite.createdAt;
                return (
                  <div
                    key={invite.id}
                    className={`grid cursor-pointer grid-cols-[44px_minmax(200px,1fr)_140px_110px_140px_140px] items-center gap-3 px-4 py-3 hover:bg-slate-50 ${
                      selectedInviteIds.has(invite.id) ? 'bg-blue-50/60' : ''
                    }`}
                    onClick={() => setSelectedInviteId(invite.id)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedInviteIds.has(invite.id)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => toggleSelectInvite(invite.id)}
                      className="h-4 w-4 rounded border-slate-300"
                      aria-label={`Select ${invite.name}`}
                    />
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-900">{invite.name}</span>
                      <span className="text-xs text-slate-500">{invite.email}</span>
                    </div>
                    <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${status.tone}`}>
                      {status.label}
                    </span>
                    <span className="text-slate-700">
                      {attempt?.score !== null && attempt?.score !== undefined ? attempt.score : '-'}
                    </span>
                    <div className="inline-flex items-center gap-2 text-slate-600">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 text-[11px]">
                        🔗
                      </span>
                      Public URL
                    </div>
                    <span className="text-slate-600">
                      {invitedOn ? format(new Date(invitedOn), 'MMM dd, yyyy') : '-'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 text-sm text-slate-500">
          <span>
            {totalRows === 0 ? '0' : `1 - ${totalRows}`} of {totalRows}
          </span>
          <button className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-400">
            ‹
          </button>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700">
            1
          </div>
          <button className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-400">
            ›
          </button>
        </div>
      </section>

      {selectedInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="text-lg font-semibold text-slate-900">{selectedInvite.name}</h3>
              <div className="flex items-center gap-2 text-slate-500">
                <button className="h-9 w-9 rounded-lg border border-slate-200 hover:bg-slate-50">↗</button>
                <button className="h-9 w-9 rounded-lg border border-slate-200 hover:bg-slate-50">⇪</button>
                <button className="h-9 w-9 rounded-lg border border-slate-200 hover:bg-slate-50">⤓</button>
                <button
                  onClick={() => setSelectedInviteId(null)}
                  className="h-9 w-9 rounded-lg border border-slate-200 hover:bg-slate-50"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="px-6 py-4">
              <div className="flex items-center gap-6 border-b border-slate-200 text-sm">
                <span className="relative pb-3 font-semibold text-slate-900 after:absolute after:-bottom-[1px] after:left-0 after:h-[3px] after:w-full after:bg-emerald-500">
                  Performance Overview
                </span>
                <span className="pb-3 text-slate-500">Attempt Activity</span>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-900">Score</p>
                  <p className="mt-2 text-lg font-semibold text-slate-700">
                    {selectedAttempt?.score ?? 0}/{test?.totalMarks ?? 0} ({test?.totalMarks ? Math.round(((selectedAttempt?.score ?? 0) / test.totalMarks) * 100) : 0}%)
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-900">Benchmark</p>
                  <p className="mt-2 text-lg font-semibold text-slate-700">21st percentile</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-900">Integrity Issues</p>
                  <p className={`mt-2 text-lg font-semibold ${selectedAttempt?.violations ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {selectedAttempt?.violations ? 'High' : 'Low'}
                  </p>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">Integrity Summary</p>
                <p className="mt-2 text-sm text-slate-600">
                  Secure mode violations • <span className="font-semibold text-rose-600">{selectedAttempt?.violations ?? 0} occurrences</span>
                </p>
              </div>

              <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-900">Performance Summary</p>
                  <span className="text-slate-400">▾</span>
                </div>
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-900">Questions</p>
                  {selectedAttempt?.id && (
                    <Link
                      to={`/admin/attempts/${selectedAttempt.id}`}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      View Detailed Report
                    </Link>
                  )}
                </div>
                <div className="mt-3 rounded-2xl border border-slate-200 bg-white">
                  <div className="grid grid-cols-[60px_1.5fr_1fr_120px_120px_90px] gap-3 border-b border-slate-200 bg-[#f7f9fd] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <span>No.</span>
                    <span>Question</span>
                    <span>Skills</span>
                    <span>Score</span>
                    <span>Code Quality</span>
                    <span>Status</span>
                  </div>
                  <div className="px-4 py-3 text-sm text-slate-500">
                    Detailed question analytics will appear here.
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-900">Candidate Details</p>
                    <span className="text-slate-400">⤢</span>
                  </div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <div className="flex items-center justify-between">
                      <span>Full Name</span>
                      <span className="font-medium text-slate-800">{selectedInvite.name}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Email</span>
                      <span>{selectedInvite.email}</span>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-900">Assessment Details</p>
                  </div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <div className="flex items-center justify-between">
                      <span>Test</span>
                      <span className="font-medium text-slate-800">{test?.name || '-'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Taken On</span>
                      <span>{selectedAttempt?.startTime ? format(new Date(selectedAttempt.startTime), 'MMM dd, yyyy, hh:mm a') : '-'}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  <span>Candidate Status</span>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Passed</span>
                  <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">Failed</span>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">To evaluate ▾</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
