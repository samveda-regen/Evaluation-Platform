import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { Test, Pagination } from '../../types';
import { format } from 'date-fns';
import { useAuthStore } from '../../context/authStore';
import {
  ChevronRight, ChevronLeft, ChevronDown, Download, Sparkles, Search,
  LayoutGrid, List, ClipboardCheck, MoreVertical, Eye, Mail, Archive, ArchiveRestore, Trash2,
  Clock, AlignLeft, Users,
} from 'lucide-react';

interface InvitationSummary {
  total: number;
  sent: number;
  failed: number;
}

type TabFilter = 'all' | 'published' | 'draft' | 'scheduled' | 'archived';
type ViewMode = 'grid' | 'list';
type SortBy = 'recent' | 'name' | 'attempts';

function getTestStatus(test: Test): 'Published' | 'Draft' | 'Scheduled' | 'Archived' {
  const now = new Date();
  if (test.endTime && new Date(test.endTime) < now) return 'Archived';
  if (!test.isActive) return 'Draft';
  if (new Date(test.startTime) > now) return 'Scheduled';
  return 'Published';
}

function TestStatusBadge({ status }: { status: ReturnType<typeof getTestStatus> }) {
  const cfg = {
    Published: { dot: 'var(--admin-accent)', color: 'var(--admin-accent-hover)', bg: 'transparent' },
    Draft:     { dot: 'var(--admin-text-subtle)', color: 'var(--admin-accent)', bg: 'transparent' },
    Scheduled: { dot: '#FCD34D', color: 'var(--admin-accent-hover)', bg: 'transparent' },
    Archived:  { dot: 'var(--admin-text-subtle)', color: 'var(--admin-text-muted)', bg: 'transparent' },
  }[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: cfg.color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: cfg.dot }} />
      {status}
    </span>
  );
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
  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedTestForInvites, setSelectedTestForInvites] = useState<Test | null>(null);
  const [invitationFile, setInvitationFile] = useState<File | null>(null);
  const [customMessage, setCustomMessage] = useState('');
  const [sendingInvitations, setSendingInvitations] = useState(false);
  const [invitationSummary, setInvitationSummary] = useState<InvitationSummary | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('recent');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  const latestRequestIdRef = useRef(0);
  const hasLoadedTestsRef = useRef(false);
  const ownerLabel = admin?.name || admin?.email || 'Admin';

  useEffect(() => {
    const id = setTimeout(() => {
      setPage(1);
      setAppliedSearch(searchInput.trim());
    }, 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  useEffect(() => { loadTests(); }, [page, appliedSearch]);

  const loadTests = async () => {
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    if (!hasLoadedTestsRef.current) setLoading(true);
    else setRefreshing(true);
    try {
      const { data } = await adminApi.getTests(page, 12, appliedSearch);
      if (latestRequestIdRef.current !== requestId) return;
      hasLoadedTestsRef.current = true;
      setTests(data.tests);
      setPagination(data.pagination);
      setSelectedTestIds(prev => {
        const next = new Set<string>();
        data.tests.forEach((t: Test) => { if (prev.has(t.id)) next.add(t.id); });
        return next;
      });
    } catch {
      if (latestRequestIdRef.current === requestId) toast.error('Failed to load tests');
    } finally {
      if (latestRequestIdRef.current === requestId) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  const filteredTests = tests.filter(test => {
    if (activeTab === 'all') return true;
    return getTestStatus(test).toLowerCase() === activeTab;
  });

  const toggleSelectTest = (testId: string) => {
    setSelectedTestIds(prev => {
      const next = new Set(prev);
      next.has(testId) ? next.delete(testId) : next.add(testId);
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (!selectedTestIds.size) return;
    if (!window.confirm(`Delete ${selectedTestIds.size} selected test${selectedTestIds.size > 1 ? 's' : ''}? This cannot be undone.`)) return;
    setBulkDeleting(true);
    const ids = Array.from(selectedTestIds);
    try {
      const results = await Promise.allSettled(ids.map(id => adminApi.deleteTest(id)));
      const successIds = ids.filter((_, i) => results[i].status === 'fulfilled');
      const failedCount = ids.length - successIds.length;
      if (successIds.length) {
        const successSet = new Set(successIds);
        setTests(prev => prev.filter(t => !successSet.has(t.id)));
        setSelectedTestIds(prev => { const next = new Set(prev); successIds.forEach(id => next.delete(id)); return next; });
      }
      if (failedCount === 0) toast.success(`Deleted ${successIds.length} test${successIds.length > 1 ? 's' : ''}`);
      else if (!successIds.length) toast.error('Unable to delete selected test(s).');
      else toast.success(`Deleted ${successIds.length} test(s). ${failedCount} could not be deleted.`);
      await loadTests();
    } finally { setBulkDeleting(false); }
  };

  const handleDeleteSingle = async (testId: string, testName: string) => {
    if (!window.confirm(`Delete "${testName}"? This cannot be undone.`)) return;
    try {
      await adminApi.deleteTest(testId);
      setTests(prev => prev.filter(t => t.id !== testId));
      toast.success('Test deleted');
      await loadTests();
    } catch { toast.error('Failed to delete test'); }
  };

  const handleArchiveSingle = async (testId: string, testName: string) => {
    if (!window.confirm(`Archive "${testName}"? It will no longer be accessible to candidates.`)) return;
    try {
      await adminApi.updateTest(testId, { endTime: new Date(Date.now() - 1000).toISOString() });
      toast.success('Test archived');
      await loadTests();
    } catch { toast.error('Failed to archive test'); }
  };

  const handleUnarchiveSingle = async (testId: string, testName: string) => {
    if (!window.confirm(`Unarchive "${testName}"? Candidates will be able to access it again.`)) return;
    try {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await adminApi.updateTest(testId, { endTime: futureDate });
      toast.success('Test unarchived');
      await loadTests();
    } catch { toast.error('Failed to unarchive test'); }
  };

  const escapeCsv = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const downloadCsv = (rows: Test[]) => {
    const headers = ['Test Name','Description','Questions','Duration (minutes)','Owner','Start Date','Status','Not Attempted','Completed','To Evaluate'];
    const csvRows = rows.map(t => [t.name, t.description?.trim()||'General', t._count?.questions||0, t.duration, ownerLabel, format(new Date(t.startTime),'yyyy/MM/dd'), t.isActive?'Active':'Draft', 0, t._count?.attempts||0, 0]);
    const csv = [headers,...csvRows].map(r => r.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob([`?${csv}`],{type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `tests-export-${format(new Date(),'yyyy-MM-dd')}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const { data } = await adminApi.getTests(1, 100, appliedSearch);
      let all: Test[] = data.tests || [];
      const totalPages = data.pagination?.totalPages || 1;
      for (let p = 2; p <= totalPages; p++) {
        const r = await adminApi.getTests(p, 100, appliedSearch);
        all = [...all, ...(r.data.tests||[])];
      }
      if (!all.length) { toast.error('No tests to export'); return; }
      downloadCsv(all);
      toast.success('Tests exported');
    } catch { toast.error('Failed to export'); } finally { setExporting(false); }
  };

  const openInvite = (test: Test) => { setSelectedTestForInvites(test); setInvitationFile(null); setCustomMessage(''); setInvitationSummary(null); };
  const closeInvite = () => { if (sendingInvitations) return; setSelectedTestForInvites(null); setInvitationFile(null); setCustomMessage(''); setInvitationSummary(null); };

  const handleSendInvitations = async () => {
    if (!selectedTestForInvites) return;
    if (!invitationFile) { toast.error('Please upload a CSV or XLSX file'); return; }
    const formData = new FormData();
    formData.append('file', invitationFile);
    if (customMessage.trim()) formData.append('customMessage', customMessage.trim());
    setSendingInvitations(true); setInvitationSummary(null);
    try {
      const { data } = await adminApi.sendInvitations(selectedTestForInvites.id, formData);
      setInvitationSummary(data);
      toast.success('Invitation batch completed');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Failed to send invitations');
    } finally { setSendingInvitations(false); }
  };

  const tabs: { key: TabFilter; label: string }[] = [
    { key: 'all', label: 'All tests' },
    { key: 'published', label: 'Published' },
    { key: 'draft', label: 'Draft' },
    { key: 'scheduled', label: 'Scheduled' },
    { key: 'archived', label: 'Archived' },
  ];

  const tabCounts: Record<TabFilter, number> = {
    all: tests.length,
    published: tests.filter(t => getTestStatus(t) === 'Published').length,
    draft: tests.filter(t => getTestStatus(t) === 'Draft').length,
    scheduled: tests.filter(t => getTestStatus(t) === 'Scheduled').length,
    archived: tests.filter(t => getTestStatus(t) === 'Archived').length,
  };

  const sortLabels: Record<SortBy, string> = {
    recent: 'Recently updated',
    name: 'Name A-Z',
    attempts: 'Most attempts',
  };

  const sortedTests = sortBy === 'name'
    ? [...filteredTests].sort((a, b) => a.name.localeCompare(b.name))
    : sortBy === 'attempts'
    ? [...filteredTests].sort((a, b) => (b._count?.attempts || 0) - (a._count?.attempts || 0))
    : filteredTests;

  return (
    <div style={{ backgroundColor: '#F9FAFB', minHeight: '100%' }}>

      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--admin-text)', margin: 0 }}>Assessments</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--admin-text-muted)' }}>Create, configure and publish assessments.</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedTestIds.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              disabled={bulkDeleting}
              className="btn btn-danger"
            >
              {bulkDeleting ? 'Deleting...' : `Delete (${selectedTestIds.size})`}
            </button>
          )}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="btn btn-secondary"
          >
            <Download size={16} />
            {exporting ? 'Exporting...' : 'Export'}
          </button>
          <Link
            to="/admin/tests/agent"
            className="btn btn-secondary"
          >
            <Sparkles size={15} />
            AI Generate
          </Link>
          <Link
            to="/admin/tests/new"
            className="btn btn-primary"
          >
            + Create Test
          </Link>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        className="flex flex-wrap items-center gap-4 p-3 rounded-xl mb-5"
        style={{ backgroundColor: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}
      >
        {/* Search */}
        <div
          className="flex items-center gap-2 rounded-lg px-3"
          style={{ backgroundColor: 'var(--admin-surface-soft)', border: '1px solid var(--admin-border)', height: '36px', minWidth: '320px', flex: '1 1 420px', maxWidth: '560px' }}
        >
          <Search size={16} color="var(--admin-text-subtle)" style={{ flexShrink: 0 }} />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search tests..."
            className="bg-transparent text-sm outline-none"
            style={{ color: 'var(--admin-text-muted)', width: '100%', minWidth: 0 }}
          />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {tabs.map(tab => {
            const isActive = activeTab === tab.key;
            return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all"
              style={{
                backgroundColor: isActive ? 'var(--admin-accent)' : 'white',
                color: isActive ? 'white' : 'var(--admin-text-muted)',
                border: isActive ? '1px solid var(--admin-accent)' : '1px solid var(--admin-border)',
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(31, 53, 86, 0.08)';
                  (e.currentTarget as HTMLElement).style.color = 'var(--admin-accent-hover)';
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--admin-accent-disabled)';
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'white';
                  (e.currentTarget as HTMLElement).style.color = 'var(--admin-text-muted)';
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--admin-border)';
                }
              }}
            >
              {tab.label}
              {tabCounts[tab.key] > 0 && (
                <span
                  className="text-[11px] font-semibold"
                  style={{
                    color: isActive ? 'rgba(255,255,255,0.86)' : 'var(--admin-text-subtle)',
                  }}
                >
                  {tabCounts[tab.key]}
                </span>
              )}
            </button>
          );})}
        </div>

        {/* Right: sort + view */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
          {refreshing && <span className="text-xs" style={{ color: 'var(--admin-accent)' }}>Updating...</span>}
          <div className="relative">
            <button
              onClick={() => setSortMenuOpen(p => !p)}
              className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
              style={{ borderColor: 'var(--admin-accent-disabled)', color: 'var(--admin-accent-hover)', backgroundColor: 'white' }}
            >
              <span>{sortLabels[sortBy]}</span>
              <ChevronDown size={12} color="var(--admin-accent)" />
            </button>
            {sortMenuOpen && (
              <div
                className="absolute right-0 top-9 z-30 rounded-xl py-1"
                style={{ backgroundColor: 'white', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', border: '1px solid var(--admin-accent-disabled)', minWidth: '168px' }}
              >
                {(['recent', 'name', 'attempts'] as SortBy[]).map(opt => (
                  <button
                    key={opt}
                    onClick={() => { setSortBy(opt); setSortMenuOpen(false); }}
                    className="flex w-full items-center text-sm text-left"
                    style={{
                      padding: '8px 14px',
                      backgroundColor: sortBy === opt ? 'var(--admin-accent-disabled)' : 'transparent',
                      color: sortBy === opt ? 'var(--admin-accent-hover)' : 'var(--admin-text-muted)',
                      borderRadius: sortBy === opt ? '8px' : '0',
                      margin: sortBy === opt ? '2px 4px' : '0',
                      width: sortBy === opt ? 'calc(100% - 8px)' : '100%',
                      fontWeight: sortBy === opt ? 600 : 400,
                      transition: 'background-color 0.13s',
                    }}
                  >
                    {sortLabels[opt]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div
            className="flex items-center rounded-lg border"
            style={{ borderColor: 'var(--admin-accent-disabled)', overflow: 'hidden' }}
          >
            <button
              onClick={() => setViewMode('grid')}
              className="flex items-center justify-center px-2.5 py-1.5 transition-colors"
              style={{ backgroundColor: viewMode === 'grid' ? 'var(--admin-accent-soft)' : 'white', color: viewMode === 'grid' ? 'var(--admin-accent)' : 'var(--admin-accent-hover)', transition: 'background-color 0.13s' }}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className="flex items-center justify-center px-2.5 py-1.5 transition-colors"
              style={{ backgroundColor: viewMode === 'list' ? 'var(--admin-accent-soft)' : 'white', color: viewMode === 'list' ? 'var(--admin-accent)' : 'var(--admin-accent-hover)', borderLeft: '1px solid var(--admin-accent-disabled)', transition: 'background-color 0.13s' }}
            >
              <List size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500" />
        </div>
      ) : sortedTests.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-xl py-20"
          style={{ backgroundColor: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}
        >
          <div className="h-14 w-14 rounded-xl flex items-center justify-center mb-4" style={{ backgroundColor: 'var(--admin-accent-soft)' }}>
            <ClipboardCheck size={24} color="var(--admin-accent)" />
          </div>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--admin-text-muted)' }}>
            {appliedSearch ? 'No tests match your search' : activeTab !== 'all' ? `No ${activeTab} tests` : 'No tests yet'}
          </p>
          <p className="text-xs mb-4" style={{ color: 'var(--admin-text-subtle)' }}>
            {appliedSearch ? 'Try a different search term' : 'Create your first test to get started'}
          </p>
          {!appliedSearch && (
            <Link to="/admin/tests/new" className="btn btn-primary">
              Create Test
            </Link>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        /* Grid View */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sortedTests.map(test => {
            const status = getTestStatus(test);
            const attempts = test._count?.attempts || 0;
            return (
              <div
                key={test.id}
                className="rounded-xl p-5 cursor-pointer relative"
                style={{ backgroundColor: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', transition: 'background-color 0.18s ease, box-shadow 0.18s ease' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(31, 53, 86, 0.06)'; e.currentTarget.style.boxShadow = '0 4px 16px var(--admin-focus-ring)'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'white'; e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.07)'; }}
                onClick={() => navigate(`/admin/tests/${test.id}`)}
              >
                {/* Card header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedTestIds.has(test.id)}
                      onClick={e => e.stopPropagation()}
                      onChange={() => toggleSelectTest(test.id)}
                      className="h-4 w-4 rounded"
                      style={{ accentColor: 'var(--admin-button-primary)' }}
                    />
                    <div
                      className="icon-btn h-10 w-10 rounded-xl flex items-center justify-center"
                      style={{
                        background: 'var(--admin-accent)',
                      }}
                    >
                      <ClipboardCheck size={18} color="white" strokeWidth={2} />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <TestStatusBadge status={status} />
                    {/* Context menu */}
                    <div className="relative">
                      <button
                        onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === test.id ? null : test.id); }}
                        className="flex items-center justify-center h-6 w-6 rounded"
                        style={{ color: 'var(--admin-text-subtle)' }}
                      >
                        <MoreVertical size={14} />
                      </button>
                      {openMenuId === test.id && (
                        <div
                          className="absolute right-0 top-7 z-20 rounded-xl py-1.5 w-44"
                          style={{ backgroundColor: 'white', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', border: '1px solid #FFF7ED' }}
                          onClick={e => e.stopPropagation()}
                        >
                          <button
                            className="flex w-full items-center gap-2 px-4 py-2 text-sm text-left hover:bg-gray-50"
                            style={{ color: 'var(--admin-text-muted)' }}
                            onClick={() => { setOpenMenuId(null); navigate(`/admin/tests/${test.id}`); }}
                          >
                            <Eye size={16} />
                            View details
                          </button>
                          <button
                            className="flex w-full items-center gap-2 px-4 py-2 text-sm text-left hover:bg-gray-50"
                            style={{ color: 'var(--admin-text-muted)' }}
                            onClick={() => { setOpenMenuId(null); openInvite(test); }}
                          >
                            <Mail size={16} />
                            Send invitations
                          </button>
                          {status === 'Archived' ? (
                            <button
                              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-left hover:bg-gray-50"
                              style={{ color: 'var(--admin-text-muted)' }}
                              onClick={() => { setOpenMenuId(null); handleUnarchiveSingle(test.id, test.name); }}
                            >
                              <ArchiveRestore size={16} />
                              Unarchive
                            </button>
                          ) : (
                            <button
                              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-left hover:bg-gray-50"
                              style={{ color: 'var(--admin-text-muted)' }}
                              onClick={() => { setOpenMenuId(null); handleArchiveSingle(test.id, test.name); }}
                            >
                              <Archive size={16} />
                              Archive
                            </button>
                          )}
                          <button
                            className="flex w-full items-center gap-2 px-4 py-2 text-sm text-left hover:bg-red-50"
                            style={{ color: '#DC2626' }}
                            onClick={() => { setOpenMenuId(null); handleDeleteSingle(test.id, test.name); }}
                          >
                            <Trash2 size={16} />
                            Delete test
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Test name & code */}
                <h3 className="font-semibold text-sm leading-snug mb-1" style={{ color: 'var(--admin-text)' }}>{test.name}</h3>
                <p className="text-xs mb-4" style={{ color: 'var(--admin-text-subtle)' }}>{test.testCode || `#${test.id.slice(0,8).toUpperCase()}`}</p>

                {/* Stats row */}
                <div className="flex items-center gap-4 text-xs mb-4" style={{ color: 'var(--admin-text-muted)' }}>
                  <span className="flex items-center gap-1.5">
                    <Clock size={12} />
                    {test.duration}m
                  </span>
                  <span className="flex items-center gap-1.5">
                    <AlignLeft size={12} />
                    {test._count?.questions || 0} Q
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Users size={12} />
                    {attempts}
                  </span>
                </div>

                {attempts === 0 && (
                  <p className="text-xs" style={{ color: 'var(--admin-text-subtle)' }}>No attempts yet</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* List View */
        <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
          {/* List header */}
          <div
            className="grid gap-4 px-5 py-3 text-xs font-semibold tracking-wide"
            style={{
              gridTemplateColumns: 'auto 1fr 100px 80px 80px 100px 40px',
              borderBottom: '1px solid #FFF7ED',
              color: 'var(--admin-text-subtle)',
            }}
          >
            <input
              type="checkbox"
              className="h-4 w-4 rounded"
              style={{ accentColor: 'var(--admin-button-primary)' }}
              checked={tests.length > 0 && tests.every(t => selectedTestIds.has(t.id))}
              onChange={() => {
                if (tests.every(t => selectedTestIds.has(t.id))) setSelectedTestIds(new Set());
                else setSelectedTestIds(new Set(tests.map(t => t.id)));
              }}
            />
            <span>TEST</span>
            <span>STATUS</span>
            <span className="text-center">QUESTIONS</span>
            <span className="text-center">ATTEMPTS</span>
            <span>CREATED</span>
            <span />
          </div>

          {sortedTests.map((test, idx) => {
            const status = getTestStatus(test);
            return (
              <div
                key={test.id}
                className="grid gap-4 px-5 py-4 cursor-pointer items-center"
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--admin-hover)')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                style={{
                  gridTemplateColumns: 'auto 1fr 100px 80px 80px 100px 40px',
                  borderBottom: idx < filteredTests.length - 1 ? '1px solid #F9FAFB' : 'none',
                }}
                onClick={() => navigate(`/admin/tests/${test.id}`)}
              >
                <input type="checkbox" checked={selectedTestIds.has(test.id)} onClick={e => e.stopPropagation()} onChange={() => toggleSelectTest(test.id)} className="h-4 w-4 rounded" style={{ accentColor: 'var(--admin-button-primary)' }} />
                <div className="flex items-center gap-3 min-w-0">
                  <div className="icon-btn h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--admin-accent)' }}>
                    <ClipboardCheck size={13} color="white" strokeWidth={2} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--admin-text)' }}>{test.name}</p>
                    <p className="text-xs" style={{ color: 'var(--admin-text-subtle)' }}>{test.testCode}</p>
                  </div>
                </div>
                <TestStatusBadge status={status} />
                <p className="text-sm text-center" style={{ color: 'var(--admin-text-muted)' }}>{test._count?.questions || 0}</p>
                <p className="text-sm text-center" style={{ color: 'var(--admin-text-muted)' }}>{test._count?.attempts || 0}</p>
                <p className="text-xs" style={{ color: 'var(--admin-text-muted)' }}>{format(new Date(test.startTime), 'MMM d, yyyy')}</p>
                <button
                  onClick={e => { e.stopPropagation(); openInvite(test); }}
                  className="flex items-center justify-center h-7 w-7 rounded-full transition-colors hover:bg-gray-100"
                  style={{ color: 'var(--admin-text-subtle)' }}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage(p => p - 1)}
            disabled={page === 1}
            className="btn btn-secondary disabled:opacity-40"
          >
            <ChevronLeft size={14} />
            Previous
          </button>
          <span className="text-sm px-3" style={{ color: 'var(--admin-text-muted)' }}>Page {page} of {pagination.totalPages}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page === pagination.totalPages}
            className="btn btn-secondary disabled:opacity-40"
          >
            Next
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Click-away overlays */}
      {sortMenuOpen && (
        <div className="fixed inset-0 z-20" onClick={() => setSortMenuOpen(false)} />
      )}
      {openMenuId && (
        <div className="fixed inset-0 z-10" onClick={() => setOpenMenuId(null)} />
      )}

      {/* Send Invitations Modal */}
      {selectedTestForInvites && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <div className="w-full max-w-lg rounded-2xl p-6" style={{ backgroundColor: 'white', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold" style={{ color: 'var(--admin-text)' }}>Send Invitations</h2>
                <p className="text-sm mt-0.5" style={{ color: 'var(--admin-text-muted)' }}>
                  Upload a CSV or XLSX with <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">name,email</code> columns for{' '}
                  <span className="font-medium" style={{ color: 'var(--admin-text)' }}>{selectedTestForInvites.name}</span>.
                </p>
              </div>
              <button
                onClick={closeInvite}
                disabled={sendingInvitations}
                style={{ color: 'var(--admin-text-subtle)', fontSize: '20px', lineHeight: 1 }}
              >&times;</button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--admin-text-muted)' }}>Candidate File</label>
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={e => setInvitationFile(e.target.files?.[0] || null)}
                  disabled={sendingInvitations}
                  className="w-full text-sm rounded-lg border px-3 py-2"
                  style={{ borderColor: '#FFF7ED', color: 'var(--admin-text-muted)' }}
                />
                <p className="text-xs mt-1" style={{ color: 'var(--admin-text-subtle)' }}>Supported: CSV, XLSX</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--admin-text-muted)' }}>Custom Message (optional)</label>
                <textarea
                  value={customMessage}
                  onChange={e => setCustomMessage(e.target.value)}
                  rows={3}
                  placeholder="Add a custom note for invitation emails..."
                  disabled={sendingInvitations}
                  className="w-full text-sm rounded-lg border px-3 py-2 outline-none resize-none"
                  style={{ borderColor: '#FFF7ED', color: 'var(--admin-text-muted)' }}
                />
              </div>

              {sendingInvitations && (
                <div className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: 'var(--admin-accent-soft)', color: 'var(--admin-accent-hover)', border: '1px solid var(--admin-accent-disabled)' }}>
                  Sending invitations in batches of 10. Please wait...
                </div>
              )}
              {invitationSummary && (
                <div className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: 'var(--admin-accent-soft)', color: 'var(--admin-accent-hover)', border: '1px solid #BBF7D0' }}>
                  Total: {invitationSummary.total} | Sent: {invitationSummary.sent} | Failed: {invitationSummary.failed}
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={handleSendInvitations}
                disabled={sendingInvitations}
                className="btn btn-primary flex-1 disabled:opacity-60"
              >
                {sendingInvitations ? 'Sending...' : 'Send Invitations'}
              </button>
              <button
                onClick={closeInvite}
                disabled={sendingInvitations}
                className="btn btn-secondary disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
