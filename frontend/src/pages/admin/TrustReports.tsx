import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { format } from 'date-fns';
import { AxiosError } from 'axios';
import { adminApi } from '../../services/api';

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

interface TrustReportRow {
  attemptId: string;
  testId: string;
  testName: string;
  testCode: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  status: string;
  isFlagged: boolean;
  startTime: string;
  endTime: string | null;
  trustScore: number;
  riskLevel: RiskLevel;
  totalViolations: number;
  violations: {
    tabSwitch: number;
    focusLoss: number;
    fullscreenExit: number;
    copyPaste: number;
    cameraBlocked: number;
    phone: number;
    multipleFaces: number;
    faceAbsent: number;
    lookingAway: number;
    voice: number;
    secondaryMonitor: number;
    suspiciousAudio: number;
    unauthorizedObject: number;
  };
  latestViolationAt: string | null;
  latestSnapshotUrl: string | null;
  llmSummary: string | null;
}

interface TestTreeNode {
  id: string;
  name: string;
  testCode: string;
  attempts: number;
}

export default function TrustReports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const testIdParam = searchParams.get('testId') || '';

  const [reports, setReports] = useState<TrustReportRow[]>([]);
  const [testTree, setTestTree] = useState<TestTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>('');
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [risk, setRisk] = useState(searchParams.get('risk') || '');
  const [flaggedOnly, setFlaggedOnly] = useState(searchParams.get('flagged') === 'true');
  const [reEvalLoading, setReEvalLoading] = useState<string | null>(null);
  const [bulkReEvalLoading, setBulkReEvalLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const selectedTestLabel = useMemo(() => {
    if (!testIdParam) return 'All Tests';
    const test = testTree.find(e => e.id === testIdParam);
    return test ? `${test.name} (${test.testCode})` : 'Selected Test';
  }, [testIdParam, testTree]);

  const stats = useMemo(() => {
    const totalCandidates = reports.length;
    const avgTrust =
      totalCandidates > 0
        ? reports.reduce((sum, row) => sum + row.trustScore, 0) / totalCandidates
        : 0;
    const flaggedCandidates = reports.filter(row => row.isFlagged).length;
    const highRiskCandidates = reports.filter(
      row => row.riskLevel === 'high' || row.riskLevel === 'critical'
    ).length;
    const totalViolations = reports.reduce((sum, row) => sum + row.totalViolations, 0);
    const phone = reports.reduce((sum, row) => sum + row.violations.phone, 0);
    const multipleFaces = reports.reduce((sum, row) => sum + row.violations.multipleFaces, 0);
    const noFace = reports.reduce((sum, row) => sum + row.violations.faceAbsent, 0);
    const offScreen = reports.reduce((sum, row) => sum + row.violations.lookingAway, 0);
    const voice = reports.reduce((sum, row) => sum + row.violations.voice, 0);
    const suspiciousAudio = reports.reduce((sum, row) => sum + (row.violations.suspiciousAudio || 0), 0);
    const unauthorizedObject = reports.reduce((sum, row) => sum + (row.violations.unauthorizedObject || 0), 0);
    return {
      totalCandidates,
      avgTrust,
      flaggedCandidates,
      highRiskCandidates,
      totalViolations,
      phone,
      multipleFaces,
      noFace,
      offScreen,
      voice,
      suspiciousAudio,
      unauthorizedObject,
    };
  }, [reports]);

  useEffect(() => {
    void loadReports();
  }, [testIdParam, risk, flaggedOnly]);

  const loadReports = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data } = await adminApi.getTrustReports({
        testId: testIdParam || undefined,
        risk: (risk || undefined) as RiskLevel | undefined,
        flagged: flaggedOnly || undefined,
        search: search || undefined,
        limit: 100,
      });
      setReports(data.reports || []);
      setTestTree(data.testTree || []);
      setSelectedIds(new Set());
    } catch (error) {
      const msg =
        (error as AxiosError<{ error?: string }>)?.response?.data?.error ||
        'Failed to load trust reports';
      setLoadError(msg);
      toast.error(msg, { id: 'trust-reports-load-error' });
    } finally {
      setLoading(false);
    }
  };

  const applySearch = async () => {
    const next = new URLSearchParams(searchParams);
    if (search) next.set('search', search);
    else next.delete('search');
    setSearchParams(next);
    await loadReports();
  };

  const clearFilters = async () => {
    setSearch('');
    setRisk('');
    setFlaggedOnly(false);
    const next = new URLSearchParams(searchParams);
    next.delete('search');
    next.delete('risk');
    next.delete('flagged');
    setSearchParams(next);
    await loadReports();
  };

  const handleTestSelect = (testId: string) => {
    const next = new URLSearchParams(searchParams);
    if (testId) next.set('testId', testId);
    else next.delete('testId');
    setSearchParams(next);
  };

  const handleReEvaluate = async (attemptId: string) => {
    setReEvalLoading(attemptId);
    try {
      await adminApi.reEvaluateTrustReport(attemptId);
      toast.success('Trust report re-evaluated');
      await loadReports();
    } catch {
      toast.error('Failed to re-evaluate report');
    } finally {
      setReEvalLoading(null);
    }
  };

  const handleReEvaluateAll = async () => {
    if (reports.length === 0) return;
    setBulkReEvalLoading(true);
    try {
      for (const row of reports) {
        await adminApi.reEvaluateTrustReport(row.attemptId);
      }
      toast.success(`Re-evaluated ${reports.length} trust reports`);
      await loadReports();
    } catch {
      toast.error('Bulk re-evaluate failed');
    } finally {
      setBulkReEvalLoading(false);
    }
  };

  const allSelected = reports.length > 0 && reports.every(r => selectedIds.has(r.attemptId));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(reports.map(r => r.attemptId)));
    }
  };

  const toggleSelect = (attemptId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(attemptId)) next.delete(attemptId);
      else next.add(attemptId);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = window.confirm(
      `Delete ${selectedIds.size} selected attempt${selectedIds.size > 1 ? 's' : ''}? This will permanently remove the attempt records and cannot be undone.`
    );
    if (!confirmed) return;

    setBulkDeleting(true);
    let successCount = 0;
    let failCount = 0;
    const toDelete = Array.from(selectedIds);

    for (const attemptId of toDelete) {
      try {
        await adminApi.deleteAttempt(attemptId);
        successCount++;
      } catch {
        failCount++;
      }
    }

    setReports(prev => prev.filter(r => !toDelete.includes(r.attemptId)));
    setSelectedIds(new Set());
    setBulkDeleting(false);

    if (failCount === 0) {
      toast.success(`Deleted ${successCount} attempt${successCount > 1 ? 's' : ''}`);
    } else {
      toast.error(`Deleted ${successCount}, failed ${failCount}`);
    }
  };

  const exportCSV = () => {
    if (!reports.length) {
      toast.error('No report rows to export');
      return;
    }
    const header = [
      'Candidate',
      'Email',
      'Test',
      'TestCode',
      'TrustScore',
      'Risk',
      'Flagged',
      'Phone',
      'MultipleFaces',
      'No Face',
      'Off-Screen Gaze',
      'Voice',
      'TotalViolations',
      'StartTime',
      'EndTime',
    ];
    const rows = reports.map(row => [
      row.candidateName,
      row.candidateEmail,
      row.testName,
      row.testCode,
      row.trustScore.toFixed(1),
      row.riskLevel,
      row.isFlagged ? 'Yes' : 'No',
      row.violations.phone.toString(),
      row.violations.multipleFaces.toString(),
      row.violations.faceAbsent.toString(),
      row.violations.lookingAway.toString(),
      row.violations.voice.toString(),
      row.totalViolations.toString(),
      row.startTime,
      row.endTime || '',
    ]);
    const csv = [header, ...rows]
      .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trust-reports-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const riskBadge = (level: RiskLevel) => {
    if (level === 'critical') return 'badge badge-danger';
    if (level === 'high') return 'badge badge-warning';
    if (level === 'medium') return 'badge badge-info';
    return 'badge badge-success';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Trust Reports</h1>
          <p className="text-sm text-gray-500 mt-1">
            Statistical integrity view by test. Analyze violations and re-evaluate candidate trust reports.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={loadReports} className="btn btn-secondary">
            Refresh
          </button>
          <button onClick={exportCSV} className="btn btn-secondary">
            Export CSV
          </button>
          <button
            onClick={handleReEvaluateAll}
            disabled={bulkReEvalLoading || !reports.length}
            className="btn btn-primary disabled:opacity-60"
          >
            {bulkReEvalLoading ? 'Re-evaluating All...' : 'Re-evaluate All'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="card bg-white border border-blue-100">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Candidates</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{stats.totalCandidates}</p>
        </div>
        <div className="card bg-white border border-green-100">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Average Trust</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{stats.avgTrust.toFixed(1)}%</p>
        </div>
        <div className="card bg-white border border-amber-100">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Flagged</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{stats.flaggedCandidates}</p>
        </div>
        <div className="card bg-white border border-rose-100">
          <p className="text-xs text-gray-500 uppercase tracking-wide">High Risk</p>
          <p className="text-2xl font-bold text-rose-600 mt-1">{stats.highRiskCandidates}</p>
        </div>
        <div className="card bg-white border border-indigo-100">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Violations</p>
          <p className="text-2xl font-bold text-indigo-600 mt-1">{stats.totalViolations}</p>
          <p className="text-xs text-gray-500 mt-1">
            P:{stats.phone} M:{stats.multipleFaces} NF:{stats.noFace} OSG:{stats.offScreen} V:{stats.voice}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="card lg:col-span-1 bg-white border border-slate-200">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
            Test Folders
          </p>
          <button
            className={`w-full text-left px-3 py-2 rounded-lg mb-2 border ${
              !testIdParam ? 'bg-blue-50 border-blue-200 text-blue-700' : 'hover:bg-gray-50 border-gray-200'
            }`}
            onClick={() => handleTestSelect('')}
          >
            <span className="font-medium">All Tests</span>
          </button>
          <div className="space-y-2 max-h-[520px] overflow-auto pr-1">
            {testTree.map(test => (
              <button
                key={test.id}
                className={`w-full text-left px-3 py-2 rounded-lg border ${
                  testIdParam === test.id
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'hover:bg-gray-50 border-gray-200'
                }`}
                onClick={() => handleTestSelect(test.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate">
                    <p className="font-medium truncate">{test.name}</p>
                    <p className="text-xs text-gray-500 truncate">{test.testCode}</p>
                  </div>
                  <span className="text-xs bg-gray-100 rounded px-2 py-1">{test.attempts}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="card lg:col-span-3 bg-white border border-slate-200">
          <div className="flex flex-wrap gap-3 items-end mb-4 pb-4 border-b border-slate-100">
            <div className="min-w-[250px]">
              <label className="block text-sm text-gray-600 mb-1">Search Candidate / Test</label>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="name, email, test"
                className="input w-full"
              />
            </div>
            <button className="btn btn-primary" onClick={applySearch}>Apply</button>
            <button className="btn btn-secondary" onClick={clearFilters}>Reset</button>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Risk</label>
              <select value={risk} onChange={e => setRisk(e.target.value)} className="input min-w-[120px]">
                <option value="">All</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <label className="flex items-center gap-2 pb-2">
              <input
                type="checkbox"
                checked={flaggedOnly}
                onChange={e => setFlaggedOnly(e.target.checked)}
              />
              <span className="text-sm">Flagged only</span>
            </label>
            <div className="ml-auto text-sm text-gray-500">
              Folder: <span className="font-medium text-gray-700">{selectedTestLabel}</span>
            </div>
          </div>

          {loading ? (
            <div className="h-48 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            </div>
          ) : loadError ? (
            <div className="py-10 text-center">
              <p className="text-red-600 font-medium">{loadError}</p>
              <p className="text-sm text-gray-500 mt-1">
                Check backend restart and admin API route `/api/admin/trust-reports`.
              </p>
            </div>
          ) : reports.length === 0 ? (
            <p className="text-center text-gray-500 py-12">No trust reports found</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-600">
                  {selectedIds.size > 0
                    ? `${selectedIds.size} selected`
                    : `${reports.length} report${reports.length !== 1 ? 's' : ''}`}
                </span>
                {selectedIds.size > 0 && (
                  <button
                    onClick={handleBulkDelete}
                    disabled={bulkDeleting}
                    className="inline-flex items-center justify-center px-3 py-1.5 rounded-md bg-red-600 text-white text-xs hover:bg-red-700 disabled:opacity-60"
                  >
                    {bulkDeleting ? 'Deleting...' : `Delete Selected (${selectedIds.size})`}
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left border-b bg-slate-50">
                      <th className="py-3 px-3">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          title="Select all"
                        />
                      </th>
                      <th className="py-3 px-3 font-semibold whitespace-nowrap">Candidate</th>
                      <th className="py-3 px-3 font-semibold whitespace-nowrap">Test</th>
                      <th className="py-3 px-3 font-semibold whitespace-nowrap text-center">Trust %</th>
                      <th className="py-3 px-3 font-semibold whitespace-nowrap">Risk</th>
                      <th className="py-3 px-3 font-semibold whitespace-nowrap text-center">Phone</th>
                      <th className="py-3 px-3 font-semibold whitespace-nowrap text-center">Multi-Face</th>
                      <th className="py-3 px-3 font-semibold whitespace-nowrap text-center">No Face</th>
                      <th className="py-3 px-3 font-semibold whitespace-nowrap text-center">Off-Screen Gaze</th>
                      <th className="py-3 px-3 font-semibold whitespace-nowrap text-center">Voice</th>
                      <th className="py-3 px-3 font-semibold whitespace-nowrap text-center">Total</th>
                      <th className="py-3 px-3 font-semibold whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map(row => (
                      <tr
                        key={row.attemptId}
                        className={`border-b last:border-0 align-top hover:bg-slate-50/60 ${
                          selectedIds.has(row.attemptId) ? 'bg-blue-50' : ''
                        }`}
                      >
                        <td className="py-3 px-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(row.attemptId)}
                            onChange={() => toggleSelect(row.attemptId)}
                          />
                        </td>
                        <td className="py-3 px-3 max-w-[220px]">
                          <p className="font-medium truncate">{row.candidateName}</p>
                          <p className="text-gray-500 truncate">{row.candidateEmail}</p>
                          <p className="text-xs text-gray-400 mt-1 whitespace-nowrap">
                            {format(new Date(row.startTime), 'MMM d, yyyy h:mm a')}
                          </p>
                          {row.llmSummary && (
                            <p className="text-xs text-gray-500 mt-2 max-w-[220px] line-clamp-2">
                              {row.llmSummary}
                            </p>
                          )}
                        </td>
                        <td className="py-3 px-3 max-w-[160px]">
                          <p className="font-medium truncate">{row.testName}</p>
                          <p className="text-xs text-gray-500 truncate">{row.testCode}</p>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className={`text-lg font-bold ${row.trustScore >= 75 ? 'text-green-600' : row.trustScore >= 50 ? 'text-amber-500' : 'text-red-600'}`}>
                            {row.trustScore.toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex flex-col gap-1">
                            <span className={riskBadge(row.riskLevel)}>{row.riskLevel}</span>
                            {row.isFlagged && <span className="badge badge-danger">flagged</span>}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center font-medium">{row.violations.phone}</td>
                        <td className="py-3 px-3 text-center font-medium">{row.violations.multipleFaces}</td>
                        <td className="py-3 px-3 text-center font-medium">{row.violations.faceAbsent}</td>
                        <td className="py-3 px-3 text-center font-medium">{row.violations.lookingAway}</td>
                        <td className="py-3 px-3 text-center font-medium">{row.violations.voice}</td>
                        <td className="py-3 px-3 text-center">
                          <span className={`font-bold text-base ${row.totalViolations > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                            {row.totalViolations}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex flex-col gap-2 min-w-[120px]">
                            <Link
                              to={`/admin/attempts/${row.attemptId}/proctoring`}
                              className="inline-flex items-center justify-center px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs hover:bg-blue-700 transition-colors"
                            >
                              Open Report
                            </Link>
                            <button
                              className="inline-flex items-center justify-center px-3 py-1.5 rounded-md bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 text-xs disabled:text-gray-400 disabled:border-gray-200"
                              onClick={() => handleReEvaluate(row.attemptId)}
                              disabled={reEvalLoading === row.attemptId}
                            >
                              {reEvalLoading === row.attemptId ? 'Re-evaluating...' : 'Re-evaluate'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
