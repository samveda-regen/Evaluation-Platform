import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../../services/api';
import {
  CheckSquare,
  Braces,
  Brain,
  FolderCode,
  ToggleLeft,
  ToggleRight,
  LibraryBig,
  FileDown,
  Plus,
  ChevronDown,
  Search,
  Pencil,
  ArrowLeft,
} from 'lucide-react';
import BackButton from '../../../components/BackButton';
import CustomSelect from '../../../components/CustomSelect';
import type {
  Pagination,
  RepositoryCategory,
  RepositoryCodingQuestion,
  RepositoryMCQQuestion,
  RepositoryQuestion,
  Test,
} from '../../../types';

/* -- Sidebar item types -- */
type SidebarCategory = RepositoryCategory | 'all' | 'CUSTOM';

interface SidebarItem {
  id: string;
  label: string;
  category: SidebarCategory;
  topic?: string;
}
const SIDEBAR_ITEMS: SidebarItem[] = [
  { id:'all',       label:'All questions', category:'all' },
  { id:'MCQ',       label:'MCQ',           category:'MCQ' },
  { id:'CODING',    label:'Coding',        category:'CODING' },
  { id:'BEHAVIORAL',label:'Behavioral',    category:'BEHAVIORAL' },
  { id:'CUSTOM',    label:'Custom Questions', category:'CUSTOM' },
];

type Difficulty = 'easy' | 'medium' | 'hard';
const CUSTOM_CATEGORIES: RepositoryCategory[] = ['MCQ', 'CODING', 'BEHAVIORAL'];
const CUSTOM_FETCH_LIMIT = 100;
const PAGE_SIZE = 20;

/* -- Type helpers -- */
function isMCQ(q: RepositoryQuestion): q is RepositoryMCQQuestion { return q.repositoryCategory === 'MCQ'; }
function isCoding(q: RepositoryQuestion): q is RepositoryCodingQuestion { return q.repositoryCategory === 'CODING'; }

/* -- Question title -- */
function qTitle(q: RepositoryQuestion): string {
  if (isMCQ(q)) return q.questionText;
  return (q as { title: string }).title || '';
}

function byNewestFirst(a: RepositoryQuestion, b: RepositoryQuestion) {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

/* -- Type icon -- */
function TypeIcon({
  cat,
  size = 32,
  iconSize = 14,
  isCustom = false,
}: {
  cat: RepositoryCategory;
  size?: number;
  iconSize?: number;
  isCustom?: boolean;
}) {
  const boxStyle = {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: size <= 28 ? '6px' : '8px',
    backgroundColor: isCustom ? 'rgba(234, 112, 48, 0.12)' : 'var(--admin-accent-soft)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  };

  if (isCustom) return (
    <div style={boxStyle}>
      <FolderCode width={iconSize} height={iconSize} stroke="var(--admin-accent)" strokeWidth={2} />
    </div>
  );

  if (cat === 'MCQ') return (
    <div style={boxStyle}>
      <CheckSquare width={iconSize} height={iconSize} stroke="var(--admin-accent-hover)" strokeWidth={2} />
    </div>
  );
  if (cat === 'CODING') return (
    <div style={boxStyle}>
      <Braces width={iconSize} height={iconSize} stroke="var(--admin-accent-hover)" strokeWidth={2} />
    </div>
  );
  return (
    <div style={boxStyle}>
      <Brain width={iconSize} height={iconSize} stroke="var(--admin-accent-hover)" strokeWidth={2} />
    </div>
  );
}

function SidebarIcon({ category, active }: { category: SidebarCategory; active: boolean }) {
  const color = active ? 'var(--admin-accent-hover)' : 'var(--admin-text-subtle)';
  const common = { width: 14, height: 14, stroke: color, strokeWidth: 1.8 };
  if (category === 'MCQ') return <CheckSquare {...common} />;
  if (category === 'CODING') return <Braces {...common} />;
  if (category === 'BEHAVIORAL') return <Brain {...common} />;
  if (category === 'CUSTOM') return <FolderCode {...common} />;
  return <LibraryBig {...common} />;
}

const META_BADGE_CFG = { bg:'var(--admin-accent-soft)', color:'var(--admin-accent-hover)' };

function Badge({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <span style={{ fontSize:'11px', fontWeight:500, padding:'2px 8px', borderRadius:'20px', backgroundColor:bg, color, whiteSpace:'nowrap' }}>
      {label}
    </span>
  );
}

/* -- Toggle icon -- */
function ToggleIcon({ enabled }: { enabled: boolean }) {
  return enabled
    ? <ToggleRight width={22} height={22} stroke="currentColor" strokeWidth={1.5} />
    : <ToggleLeft  width={22} height={22} stroke="currentColor" strokeWidth={1.5} />;
}

export default function QuestionBank() {
  const navigate = useNavigate();
  const location = useLocation();

  // If navigated from a test's "Add from Library" button, these will be set
  const routeState = location.state as {
    fromTestId?: string;
    fromTestName?: string;
    fromTestQuestionIds?: string[];
    returnTo?: string;
    activeSection?: SidebarCategory;
  } | null;
  const urlParams = new URLSearchParams(location.search);
  const fromTestId: string | undefined = routeState?.fromTestId ?? urlParams.get('fromTestId') ?? undefined;
  const fromTestName: string | undefined = routeState?.fromTestName ?? urlParams.get('fromTestName') ?? undefined;
  const fromTestQuestionIds = routeState?.fromTestQuestionIds ?? [];
  const returnTo = routeState?.returnTo ?? urlParams.get('returnTo') ?? (fromTestId ? `/admin/tests/${fromTestId}?tab=questions` : '/admin/repository/question-bank');
  const initialSidebarItem = SIDEBAR_ITEMS.find(item => item.category === routeState?.activeSection) ?? SIDEBAR_ITEMS[0];

  /* -- State -- */
  const [activeItem,   setActiveItem]   = useState<SidebarItem>(initialSidebarItem);
  const [questions,    setQuestions]    = useState<RepositoryQuestion[]>([]);
  const [pagination,   setPagination]   = useState<Pagination | null>(null);
  const [counts,       setCounts]       = useState<Record<string, number>>({});
  const [loading,      setLoading]      = useState(true);
  const [page,         setPage]         = useState(1);
  const [search,       setSearch]       = useState('');
  const [draftSearch,  setDraftSearch]  = useState('');
  const [selectedDiffs, setSelectedDiffs] = useState<Set<Difficulty>>(new Set(['easy', 'medium', 'hard']));
  const [showNewDrop,  setShowNewDrop]  = useState(false);
  const [newDropIndex, setNewDropIndex] = useState(0);
  const [sortOrder,    setSortOrder]    = useState<'most-used'|'newest'|'marks'>('most-used');
  const dropRef = useRef<HTMLDivElement>(null);
  const [editBeh, setEditBeh] = useState({
    open: false, id: '', title: '', description: '', marks: 5,
    difficulty: 'medium' as Difficulty, topic: '', expectedAnswer: '',
  });
  const [savingBeh, setSavingBeh] = useState(false);

  /* add-to-test modal */
  const [addModal,       setAddModal]       = useState<{ q: RepositoryQuestion } | null>(null);
  const [testsList,      setTestsList]      = useState<Test[]>([]);
  const [testsLoading,   setTestsLoading]   = useState(false);
  const [addingTestId,   setAddingTestId]   = useState<string | null>(null);
  const [testSearch,     setTestSearch]     = useState('');
  const [addedQuestionIds, setAddedQuestionIds] = useState<Set<string>>(new Set());
  const excludedQuestionIds = useMemo(
    () => new Set([...fromTestQuestionIds, ...addedQuestionIds]),
    [fromTestQuestionIds, addedQuestionIds]
  );
  const excludedQuestionKey = Array.from(excludedQuestionIds).sort().join('|');
  const filterAlreadyAddedQuestions = (items: RepositoryQuestion[]) =>
    excludedQuestionIds.size > 0 ? items.filter(q => !excludedQuestionIds.has(q.id)) : items;

  /* close dropdown on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowNewDrop(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* load initial counts */
  useEffect(() => {
    void loadCounts();
  }, []);

  /* reload questions on filter change */
  useEffect(() => {
    setPage(1);
  }, [activeItem, search]);

  useEffect(() => {
    setPage(1);
  }, [selectedDiffs]);

  useEffect(() => {
    void loadQuestions();
  }, [activeItem, page, search, excludedQuestionKey]);

  const loadCounts = async () => {
    try {
      const [mcq, coding, beh, customMcq, customCoding, customBeh] = await Promise.all([
        adminApi.getQuestionBankQuestions({ category:'MCQ',       page:1, limit:1 }),
        adminApi.getQuestionBankQuestions({ category:'CODING',    page:1, limit:1 }),
        adminApi.getQuestionBankQuestions({ category:'BEHAVIORAL',page:1, limit:1 }),
        adminApi.getCustomRepositoryQuestions({ category:'MCQ',       page:1, limit:1 }),
        adminApi.getCustomRepositoryQuestions({ category:'CODING',    page:1, limit:1 }),
        adminApi.getCustomRepositoryQuestions({ category:'BEHAVIORAL',page:1, limit:1 }),
      ]);
      const bankMcq = mcq.data.pagination.total;
      const bankCoding = coding.data.pagination.total;
      const bankBeh = beh.data.pagination.total;
      const customM = customMcq.data.pagination.total;
      const customC = customCoding.data.pagination.total;
      const customB = customBeh.data.pagination.total;
      const m = bankMcq + customM;
      const c = bankCoding + customC;
      const b = bankBeh + customB;
      setCounts({ all: m+c+b, MCQ: m, CODING: c, BEHAVIORAL: b, CUSTOM: customM+customC+customB });
    } catch { /* silent */ }
  };

  async function fetchQuestionsBySource(options: {
    source: 'QUESTION_BANK' | 'CUSTOM';
    category: RepositoryCategory;
    limit?: number;
    search?: string;
    topic?: string;
  }) {
    const limit = options.limit ?? CUSTOM_FETCH_LIMIT;
    const fetcher = options.source === 'CUSTOM'
      ? adminApi.getCustomRepositoryQuestions
      : adminApi.getQuestionBankQuestions;

    const firstResponse = await fetcher({
      category: options.category,
      page: 1,
      limit,
      search: options.search || undefined,
      topic: options.topic || undefined,
    });
    const { totalPages } = firstResponse.data.pagination;
    if (totalPages <= 1) return firstResponse.data;

    const restResponses = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        fetcher({
          category: options.category,
          page: index + 2,
          limit,
          search: options.search || undefined,
          topic: options.topic || undefined,
        })
      )
    );

    return {
      questions: [
        ...firstResponse.data.questions,
        ...restResponses.flatMap(response => response.data.questions),
      ],
      pagination: firstResponse.data.pagination,
    };
  }

  async function fetchCustomQuestions(options: {
    limit?: number;
    search?: string;
  } = {}) {
    const categoryResults = await Promise.all(
      CUSTOM_CATEGORIES.map(category =>
        fetchQuestionsBySource({
          source: 'CUSTOM',
          category,
          limit: options.limit,
          search: options.search || undefined,
        })
      )
    );
    return {
      questions: categoryResults.flatMap(result => result.questions),
      total: categoryResults.reduce((sum, result) => sum + result.pagination.total, 0),
    };
  }

  async function fetchMergedCategoryQuestions(category: RepositoryCategory, options: {
    search?: string;
    topic?: string;
  } = {}) {
    const [bank, custom] = await Promise.all([
      fetchQuestionsBySource({
        source: 'QUESTION_BANK',
        category,
        search: options.search,
        topic: options.topic,
      }),
      fetchQuestionsBySource({
        source: 'CUSTOM',
        category,
        search: options.search,
        topic: options.topic,
      }),
    ]);

    const questions = [...bank.questions, ...custom.questions].sort(byNewestFirst);
    return {
      questions,
      total: bank.pagination.total + custom.pagination.total,
    };
  }

  const loadQuestions = async () => {
    setLoading(true);
    try {
      if (activeItem.category === 'all') {
        const [mcq, coding, behavioral] = await Promise.all([
          fetchMergedCategoryQuestions('MCQ', { search: search || undefined }),
          fetchMergedCategoryQuestions('CODING', { search: search || undefined }),
          fetchMergedCategoryQuestions('BEHAVIORAL', { search: search || undefined }),
        ]);
        const availableMcq = filterAlreadyAddedQuestions(mcq.questions);
        const availableCoding = filterAlreadyAddedQuestions(coding.questions);
        const availableBehavioral = filterAlreadyAddedQuestions(behavioral.questions);
        const combined = [...availableMcq, ...availableCoding, ...availableBehavioral].sort(byNewestFirst);
        const total = combined.length;
        const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        if (page > totalPages) {
          setPage(totalPages);
          return;
        }
        const start = (page - 1) * PAGE_SIZE;
        setQuestions(combined.slice(start, start + PAGE_SIZE));
        setPagination({ page, limit: PAGE_SIZE, total, totalPages });
        setCounts(prev => ({
          ...prev,
          all: total,
          MCQ: availableMcq.length,
          CODING: availableCoding.length,
          BEHAVIORAL: availableBehavioral.length,
        }));
      } else if (activeItem.category === 'CUSTOM') {
        const { questions: custom } = await fetchCustomQuestions({ search: search || undefined });
        const availableCustom = filterAlreadyAddedQuestions(custom);
        const total = availableCustom.length;
        const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        if (page > totalPages) {
          setPage(totalPages);
          return;
        }
        const start = (page - 1) * PAGE_SIZE;
        setQuestions(availableCustom.slice(start, start + PAGE_SIZE));
        setPagination({ page, limit: PAGE_SIZE, total, totalPages });
        setCounts(prev => ({ ...prev, CUSTOM: total }));
      } else {
        const { questions: merged } = await fetchMergedCategoryQuestions(activeItem.category as RepositoryCategory, {
          search: search || undefined,
          topic: activeItem.topic || undefined,
        });
        const availableMerged = filterAlreadyAddedQuestions(merged);
        const total = availableMerged.length;
        const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        if (page > totalPages) {
          setPage(totalPages);
          return;
        }
        const start = (page - 1) * PAGE_SIZE;
        setQuestions(availableMerged.slice(start, start + PAGE_SIZE));
        setPagination({ page, limit: PAGE_SIZE, total, totalPages });
        setCounts(prev => ({ ...prev, [activeItem.id]: total }));
      }
    } catch { toast.error('Failed to load questions'); }
    finally { setLoading(false); }
  };

  const visibleQuestions = questions.filter(q => selectedDiffs.has(q.difficulty as Difficulty));

  const handleToggle = async (q: RepositoryQuestion) => {
    const nextEnabled = !q.isEnabled;
    const applyEnabledState = (items: RepositoryQuestion[]) =>
      items.map(item => item.id === q.id ? { ...item, isEnabled: nextEnabled } : item);

    try {
      if (q.isEnabled) {
        if (q.source === 'CUSTOM') {
          await adminApi.disableCustomRepositoryQuestion(q.id, q.repositoryCategory);
        } else {
          await adminApi.disableQuestionBankQuestion(q.id, q.repositoryCategory);
        }
        toast.success('Question disabled');
      } else {
        if (q.source === 'CUSTOM') {
          await adminApi.enableCustomRepositoryQuestion(q.id, q.repositoryCategory);
        } else {
          await adminApi.enableQuestionBankQuestion(q.id, q.repositoryCategory);
        }
        toast.success('Question enabled');
      }
      setQuestions(applyEnabledState);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Failed to update');
    }
  };

  const handleSidebarClick = (item: SidebarItem) => {
    setActiveItem(item);
    setDraftSearch('');
    setSearch('');
    setPage(1);
  };

  const toggleDifficulty = (difficulty: Difficulty) => {
    setSelectedDiffs(prev => {
      const next = new Set(prev);
      next.has(difficulty) ? next.delete(difficulty) : next.add(difficulty);
      return next;
    });
  };

  const handleEdit = (q: RepositoryQuestion) => {
    const editState = {
      question: q,
      returnTo,
      activeSection: activeItem.category,
    };

    if (isMCQ(q)) {
      navigate(`/admin/mcq/${q.id}/edit`, { state: editState });
    } else if (isCoding(q)) {
      navigate(`/admin/coding/${q.id}/edit`, { state: editState });
    } else {
      navigate(`/admin/behavioral/${q.id}/edit`, { state: editState });
    }
  };

  const openAddToTest = async (q: RepositoryQuestion) => {
    setAddModal({ q });
    setTestSearch('');
    setTestsList([]);
    setTestsLoading(true);
    try {
      const { data } = await adminApi.getTests(1, 100);
      setTestsList((data.tests as Test[]) ?? []);
    } catch { toast.error('Failed to load tests'); }
    finally { setTestsLoading(false); }
  };

  const handleAddToTest = async (testId: string) => {
    if (!addModal) return;
    const q = addModal.q;
    setAddingTestId(testId);
    try {
      const questionType = q.repositoryCategory.toLowerCase(); // 'mcq' | 'coding' | 'behavioral'
      await adminApi.addQuestionToTest(testId, { questionId: q.id, questionType });
      toast.success('Added to test');
      setAddModal(null);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Failed to add question');
    } finally { setAddingTestId(null); }
  };

  // Direct add used when coming from a specific test's "Add from Library" button
  const handleAddDirectToTest = async (q: RepositoryQuestion, targetTestId: string) => {
    setAddingTestId(targetTestId + q.id);
    try {
      const questionType = q.repositoryCategory.toLowerCase();
      await adminApi.addQuestionToTest(targetTestId, { questionId: q.id, questionType });
      toast.success('Added to test');
      setAddedQuestionIds(prev => {
        const next = new Set(prev);
        next.add(q.id);
        return next;
      });
      setQuestions(prev => prev.filter(item => item.id !== q.id));
      setPagination(prev => {
        if (!prev) return prev;
        const total = Math.max(0, prev.total - 1);
        const totalPages = Math.max(1, Math.ceil(total / prev.limit));
        return { ...prev, total, totalPages, page: Math.min(prev.page, totalPages) };
      });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Failed to add question');
    } finally { setAddingTestId(null); }
  };

  const handleSaveBehavioral = async () => {
    if (!editBeh.title.trim()) { toast.error('Title required'); return; }
    if (editBeh.marks < 1) { toast.error('Marks must be greater than 0'); return; }
    setSavingBeh(true);
    try {
      await adminApi.updateCustomBehavioral(editBeh.id, {
        title: editBeh.title,
        description: editBeh.description || undefined,
        marks: editBeh.marks,
        difficulty: editBeh.difficulty,
        topic: editBeh.topic || undefined,
        expectedAnswer: editBeh.expectedAnswer || undefined,
      });
      toast.success('Question updated');
      setEditBeh(p => ({ ...p, open: false }));
      void loadQuestions();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Failed to update');
    } finally {
      setSavingBeh(false);
    }
  };

  const isDifficultyFiltered = selectedDiffs.size < 3;
  const totalShown = isDifficultyFiltered ? visibleQuestions.length : pagination?.total ?? visibleQuestions.length;
  const difficultyCounts = questions.reduce<Record<Difficulty, number>>((acc, question) => {
    const difficulty = question.difficulty as Difficulty;
    if (difficulty in acc) acc[difficulty] += 1;
    return acc;
  }, { easy: 0, medium: 0, hard: 0 });

  /* extra stats from API if available */
  const usageCount = (q: RepositoryQuestion): string => {
    const r = q as unknown as Record<string, number>;
    const n = r.usageCount ?? r.totalUses ?? r.uses ?? null;
    return n != null ? String(n) : '-';
  };
  const correctRate = (q: RepositoryQuestion): string | null => {
    const r = q as unknown as Record<string, number>;
    const n = r.correctRate ?? r.avgCorrectRate ?? r.correctPercentage ?? null;
    return n != null ? `${Math.round(n)}%` : null;
  };

  const sortedQuestions = [...visibleQuestions].sort((a, b) => {
    if (sortOrder === 'marks') return (b.marks || 0) - (a.marks || 0);
    if (sortOrder === 'newest') {
      const getTime = (q: RepositoryQuestion) => {
        const maybe = q as unknown as { createdAt?: string; updatedAt?: string };
        return new Date(maybe.createdAt || maybe.updatedAt || 0).getTime() || 0;
      };
      return getTime(b) - getTime(a);
    }
    const getUses = (q: RepositoryQuestion) => {
      const r = q as unknown as Record<string, number>;
      return r.usageCount ?? r.totalUses ?? r.uses ?? 0;
    };
    return getUses(b) - getUses(a);
  });
  const newQuestionOptions = [
    { label:'MCQ question',        category:'MCQ' as RepositoryCategory, path:'/admin/mcq/new' },
    { label:'Coding question',     category:'CODING' as RepositoryCategory, path:'/admin/coding/new' },
    { label:'Behavioral question', category:'BEHAVIORAL' as RepositoryCategory, path:'/admin/behavioral/new' },
  ];
  const activateNewQuestionOption = (index: number) => {
    const option = newQuestionOptions[index];
    if (!option) return;
    setShowNewDrop(false);
    navigate(option.path);
  };
  const handleNewDropKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!showNewDrop) {
        setShowNewDrop(true);
        setNewDropIndex(0);
        return;
      }
      const direction = e.key === 'ArrowDown' ? 1 : -1;
      setNewDropIndex(i => (i + direction + newQuestionOptions.length) % newQuestionOptions.length);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (showNewDrop) activateNewQuestionOption(newDropIndex);
      else setShowNewDrop(true);
      return;
    }
    if (e.key === 'Escape' && showNewDrop) {
      e.preventDefault();
      setShowNewDrop(false);
    }
  };

  return (
    <div className="admin-page">

      {/* -- "Adding to test" banner -- */}
      {fromTestId && (
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'10px 16px', marginBottom:'16px', borderRadius:'var(--admin-card-radius)',
          backgroundColor:'var(--admin-accent-soft)', border:'1.5px solid var(--admin-accent-disabled)',
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
            <LibraryBig width={16} height={16} stroke="var(--admin-accent-hover)" strokeWidth={1.5} />
            <span style={{ fontSize:'13px', color:'var(--admin-accent-hover)', fontWeight:500 }}>
              Adding questions to: <strong>{fromTestName ?? 'test'}</strong>
              <span style={{ color:'var(--admin-accent)', fontWeight:400, marginLeft:'6px' }}>- click Add on any question to add it directly</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => navigate(returnTo)}
            className="admin-btn admin-btn-secondary"
            style={{ minHeight:'32px', padding:'6px 10px', fontSize:'12px' }}>
            <ArrowLeft width={13} height={13} strokeWidth={2} />
            Back to test
          </button>
        </div>
      )}

      {/* -- HEADER -- */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-start gap-3">
          <BackButton mt="3px" />
          <div>
            <h1 className="text-2xl font-bold" style={{ color:'var(--admin-text)', margin:0 }}>Question Library</h1>
            <p className="text-sm mt-0.5" style={{ color:'var(--admin-text-muted)' }}>Reusable question bank across all tests.</p>
          </div>
        </div>

        <div className="admin-header-actions">
          {/* Import CSV */}
          <button
            onClick={() => toast('CSV import coming soon')}
            className="admin-btn admin-btn-secondary">
            <FileDown width={14} height={14} strokeWidth={2} />
            Import CSV
          </button>

          {/* New question with dropdown */}
          <div ref={dropRef} style={{ position:'relative' }}>
            <button
              onClick={() => { setShowNewDrop(p=>!p); setNewDropIndex(0); }}
              onKeyDown={handleNewDropKeyDown}
              className="admin-btn admin-btn-primary"
              aria-expanded={showNewDrop}
              aria-haspopup="menu">
              <Plus width={13} height={13} stroke="white" strokeWidth={2.5} />
              Create Question
              <ChevronDown width={12} height={12} stroke="white" strokeWidth={2} />
            </button>
            {showNewDrop && (
              <div style={{
                position:'absolute', top:'100%', right:0, marginTop:'4px', zIndex:30,
                backgroundColor:'white', borderRadius:'var(--admin-control-radius)', boxShadow:'0 8px 24px rgba(31, 53, 86, 0.14)',
                border:'1px solid var(--admin-border)', minWidth:'160px', overflow:'hidden',
              }}>
                {newQuestionOptions.map((opt, index) => (
                  <button key={opt.label} onClick={() => activateNewQuestionOption(index)}
                    style={{ width:'100%', textAlign:'left', padding:'10px 14px', border:'none', backgroundColor: index === newDropIndex ? 'var(--admin-accent-soft)' : 'white', fontSize:'13px', color: index === newDropIndex ? 'var(--admin-accent-hover)' : 'var(--admin-text-muted)', cursor:'pointer', borderBottom:'1px solid var(--admin-border)', display:'flex', alignItems:'center', gap:'10px', fontWeight: index === newDropIndex ? 600 : 400 }}
                    onMouseEnter={() => setNewDropIndex(index)}>
                    <TypeIcon cat={opt.category} size={26} iconSize={13} />
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* -- REPOSITORY LAYOUT -- */}
      <div>
        {/* -- MAIN CONTENT -- */}
        <main style={{ minWidth:0 }}>
          <div
            className="flex items-center gap-9 overflow-x-auto"
            style={{
              borderBottom:'1px solid var(--admin-border-soft)',
              marginBottom:'14px',
            }}
          >
            {SIDEBAR_ITEMS.map(item => {
              const isActive = activeItem.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSidebarClick(item)}
                  className="flex items-center gap-1.5 py-3 text-sm font-semibold transition-colors"
                  style={{
                    color: isActive ? 'var(--admin-accent-hover)' : 'var(--admin-text-muted)',
                    border:0,
                    borderBottom: isActive ? '2px solid var(--admin-accent)' : '2px solid transparent',
                    background:'transparent',
                    marginBottom:'-1px',
                    whiteSpace:'nowrap',
                    cursor:'pointer',
                  }}
                >
                  <SidebarIcon category={item.category} active={isActive} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Search + count + sort */}
          <div style={{
            display:'grid',
            gridTemplateColumns:'minmax(260px, 1fr) auto auto auto',
            alignItems:'center',
            gap:'10px',
            marginBottom:'12px',
          }}>
            {/* Search */}
            <div style={{ position:'relative', minWidth:0 }}>
              <Search style={{ position:'absolute', left:'12px', top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}
                width={14} height={14} stroke="var(--admin-text-subtle)" strokeWidth={1.5} />
              <input
                value={draftSearch}
                onChange={e => setDraftSearch(e.target.value)}
                onKeyDown={e => { if (e.key==='Enter') { setSearch(draftSearch); setPage(1); } }}
                placeholder="Search questions..."
                className="admin-filter-input"
                style={{
                  width:'100%', padding:'9px 12px 9px 36px', borderRadius:'9px',
                  border:'1px solid var(--admin-border)', fontSize:'13px',
                  outline:'none', boxSizing:'border-box',
                }}
              />
            </div>
            {/* Count badge */}
            <div style={{ padding:'6px 14px', borderRadius:'20px', backgroundColor:META_BADGE_CFG.bg, fontSize:'12px', fontWeight:500, color:META_BADGE_CFG.color, whiteSpace:'nowrap', flexShrink:0 }}>
              {loading ? '...' : totalShown} questions
            </div>
            <div style={{
              display:'flex',
              alignItems:'center',
              gap:'6px',
              whiteSpace:'nowrap',
            }}>
              {(['easy', 'medium', 'hard'] as Difficulty[]).map(difficulty => {
                const checked = selectedDiffs.has(difficulty);
                return (
                  <button
                    key={difficulty}
                    type="button"
                    onClick={() => toggleDifficulty(difficulty)}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all"
                    style={{
                      backgroundColor: checked ? 'var(--admin-accent)' : 'white',
                      color: checked ? 'white' : 'var(--admin-text-muted)',
                      border: checked ? '1px solid var(--admin-accent)' : '1px solid var(--admin-border)',
                      minWidth:0,
                      whiteSpace:'nowrap',
                      cursor:'pointer',
                    }}
                    onMouseEnter={e => {
                      if (!checked) {
                        e.currentTarget.style.backgroundColor = 'rgba(31, 53, 86, 0.08)';
                        e.currentTarget.style.color = 'var(--admin-accent-hover)';
                        e.currentTarget.style.borderColor = 'var(--admin-accent-disabled)';
                      }
                    }}
                    onMouseLeave={e => {
                      if (!checked) {
                        e.currentTarget.style.backgroundColor = 'white';
                        e.currentTarget.style.color = 'var(--admin-text-muted)';
                        e.currentTarget.style.borderColor = 'var(--admin-border)';
                      }
                    }}
                  >
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>
                      {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
                    </span>
                    {difficultyCounts[difficulty] > 0 && (
                      <span
                        className="text-[11px] font-semibold"
                        style={{
                          color: checked ? 'rgba(255,255,255,0.86)' : 'var(--admin-text-subtle)',
                        }}
                      >
                        {difficultyCounts[difficulty]}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {/* Sort */}
            <CustomSelect
              value={sortOrder}
              onChange={value => setSortOrder(value as typeof sortOrder)}
              options={[
                { value: 'most-used', label: 'Most used' },
                { value: 'newest', label: 'Newest' },
                { value: 'marks', label: 'By marks' },
              ]}
              style={{ width: '140px', minWidth: '140px', flexShrink: 0 }}
            />
          </div>

          {/* Question list */}
          {loading ? (
            <div style={{ display:'flex', justifyContent:'center', padding:'60px 0' }}>
              <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor:'var(--admin-accent)' }} />
            </div>
          ) : visibleQuestions.length === 0 ? (
            <div style={{ textAlign:'center', padding:'60px 0', color:'var(--admin-text-subtle)', fontSize:'14px' }}>
              No questions found
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
              {sortedQuestions.map(q => {
                const cat  = q.repositoryCategory;
                const diff = q.difficulty as Difficulty;
                const rate = correctRate(q);
                const catLabel = cat === 'MCQ' ? 'MCQ' : cat === 'CODING' ? 'Coding' : 'Behavioral';
                const isCustomQuestion = q.source === 'CUSTOM';
                return (
                  <div key={q.id} style={{
                    position:'relative',
                    display:'flex', alignItems:'center', gap:'14px',
                    backgroundColor: q.isEnabled ? 'white' : 'var(--admin-accent-soft)',
                    borderRadius:'8px', padding:'13px 14px 13px 18px',
                    boxShadow:'var(--admin-card-shadow)',
                    border: q.isEnabled ? '1px solid var(--admin-border-soft)' : '1px solid var(--admin-accent-disabled)',
                    transition:'box-shadow 0.15s, border-color 0.15s, background-color 0.15s',
                  }}
                    onMouseEnter={e=>(e.currentTarget.style.boxShadow='0 3px 12px rgba(31, 53, 86, 0.12)')}
                    onMouseLeave={e=>(e.currentTarget.style.boxShadow='var(--admin-card-shadow)')}>
                    <div style={{
                      position:'absolute',
                      left:0,
                      top:'10px',
                      bottom:'10px',
                      width:'3px',
                      borderRadius:'0 4px 4px 0',
                      backgroundColor: cat === 'MCQ' ? 'var(--admin-accent)' : cat === 'CODING' ? 'var(--admin-accent-hover)' : 'var(--admin-text-subtle)',
                      opacity:0.45,
                    }} />

                    {/* Type icon */}
                    <TypeIcon cat={cat} isCustom={isCustomQuestion} />

                    {/* Question content */}
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontSize:'14px', fontWeight:600, color:'var(--admin-text)', margin:'0 0 6px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {qTitle(q)}
                      </p>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:'5px', alignItems:'center' }}>
                        <Badge label={catLabel} {...META_BADGE_CFG} />
                        {isCustomQuestion && (
                          <span style={{
                            display:'inline-flex',
                            alignItems:'center',
                            gap:'4px',
                            fontSize:'11px',
                            fontWeight:500,
                            padding:'2px 8px',
                            borderRadius:'20px',
                            backgroundColor:'rgba(234, 112, 48, 0.12)',
                            color:'var(--admin-accent)',
                            whiteSpace:'nowrap',
                          }}>
                            <FolderCode width={11} height={11} stroke="currentColor" strokeWidth={2} />
                            Custom
                          </span>
                        )}
                        <Badge label={diff.charAt(0).toUpperCase()+diff.slice(1)} {...META_BADGE_CFG} />
                        {q.topic && (
                          <Badge label={q.topic} {...META_BADGE_CFG} />
                        )}
                        {q.tags.slice(0,2).map(tag => (
                          <Badge key={tag} label={tag} {...META_BADGE_CFG} />
                        ))}
                      </div>
                    </div>

                    {/* Stats */}
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'12px', flexShrink:0 }}>
                      {/* Correct % */}
                      {rate && (
                        <div style={{ width:'54px', textAlign:'center' }}>
                          <p style={{ fontSize:'15px', fontWeight:700, color:'var(--admin-accent)', margin:0, lineHeight:1 }}>{rate}</p>
                          <p style={{ fontSize:'10px', color:'var(--admin-text-subtle)', margin:'2px 0 0' }}>correct</p>
                        </div>
                      )}
                      {/* Marks (when no rate) */}
                      {!rate && (
                        <div style={{ width:'54px', textAlign:'center' }}>
                          <p style={{ fontSize:'15px', fontWeight:700, color:'var(--admin-text-muted)', margin:0, lineHeight:1 }}>{q.marks}</p>
                          <p style={{ fontSize:'10px', color:'var(--admin-text-subtle)', margin:'2px 0 0' }}>marks</p>
                        </div>
                      )}
                      {/* Add to test */}
                      {(() => {
                        const isAddingThis = fromTestId ? addingTestId === fromTestId + q.id : false;
                        return (
                          <button
                            type="button"
                            onClick={() => fromTestId ? void handleAddDirectToTest(q, fromTestId) : void openAddToTest(q)}
                            disabled={isAddingThis}
                            title={fromTestId ? `Add to ${fromTestName ?? 'test'}` : 'Add to test'}
                            className="admin-btn admin-btn-secondary"
                            style={{ minHeight:'32px', padding:'6px 10px', fontSize:'12px' }}>
                            {isAddingThis ? (
                              <div className="animate-spin rounded-full h-3 w-3 border-b-2" style={{ borderColor:'var(--admin-accent-hover)' }} />
                            ) : (
                              <Plus width={13} height={13} stroke="var(--admin-accent-hover)" strokeWidth={2.5} />
                            )}
                            Add
                          </button>
                        );
                      })()}
                      {/* Toggle enable/disable */}
                      <button
                        type="button"
                        onClick={() => handleToggle(q)}
                        title={q.isEnabled ? 'Disable question' : 'Enable question'}
                        className="admin-icon-toggle"
                        data-state={q.isEnabled ? 'on' : 'off'}>
                        <ToggleIcon enabled={q.isEnabled} />
                      </button>
                      {/* Edit */}
                      <button
                        type="button"
                        onClick={() => handleEdit(q)}
                        title="Edit question"
                        style={{ padding:'6px 10px', borderRadius:'var(--admin-control-radius)', border:'1.5px solid var(--admin-border)', backgroundColor:'white', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:'4px', fontSize:'12px', fontWeight:500, color:'var(--admin-text-muted)' }}>
                        <Pencil width={13} height={13} stroke="var(--admin-text-muted)" strokeWidth={1.5} />
                        Edit
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div style={{ display:'flex', justifyContent:'center', alignItems:'center', gap:'8px', marginTop:'20px' }}>
              <button onClick={() => setPage(p=>Math.max(1,p-1))} disabled={page===1}
                className="admin-btn admin-btn-secondary">
                Previous
              </button>
              <span style={{ fontSize:'13px', color:'var(--admin-text-muted)' }}>Page {page} of {pagination.totalPages}</span>
              <button onClick={() => setPage(p=>Math.min(pagination.totalPages,p+1))} disabled={page===pagination.totalPages}
                className="admin-btn admin-btn-secondary">
                Next
              </button>
            </div>
          )}
        </main>
      </div>

      {/* -- Add to Test Modal -- */}
      {addModal && (
        <div style={{ position:'fixed', inset:0, backgroundColor:'rgba(15, 23, 42, 0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50 }}
          onClick={() => setAddModal(null)}>
          <div style={{ backgroundColor:'white', borderRadius:'var(--admin-card-radius)', padding:'28px', width:'480px', maxWidth:'90vw', maxHeight:'80vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(31, 53, 86, 0.18)' }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'6px' }}>
              <h2 style={{ fontSize:'18px', fontWeight:700, color:'var(--admin-text)', margin:0 }}>Add to Test</h2>
              <button onClick={() => setAddModal(null)}
                style={{ border:'none', background:'none', fontSize:'22px', color:'var(--admin-text-subtle)', cursor:'pointer', lineHeight:1 }}>x</button>
            </div>
            <p style={{ fontSize:'13px', color:'var(--admin-text-muted)', margin:'0 0 16px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {qTitle(addModal.q)}
            </p>

            {/* Search tests */}
            <div style={{ position:'relative', marginBottom:'12px' }}>
              <Search style={{ position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}
                width={13} height={13} stroke="var(--admin-text-subtle)" strokeWidth={1.5} />
              <input
                value={testSearch}
                onChange={e => setTestSearch(e.target.value)}
                placeholder="Search tests..."
                className="admin-filter-input"
                style={{
                  width:'100%', padding:'8px 12px 8px 32px', borderRadius:'var(--admin-field-radius)',
                  border:'1.5px solid var(--admin-border)',
                  fontSize:'13px', outline:'none', boxSizing:'border-box',
                }}
              />
            </div>

            {/* Test list */}
            <div style={{ overflowY:'auto', flex:1 }}>
              {testsLoading ? (
                <div style={{ display:'flex', justifyContent:'center', padding:'32px 0' }}>
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor:'var(--admin-accent)' }} />
                </div>
              ) : testsList.length === 0 ? (
                <p style={{ textAlign:'center', color:'var(--admin-text-subtle)', fontSize:'13px', padding:'32px 0' }}>No tests found</p>
              ) : (
                testsList
                  .filter(t => !testSearch.trim() || t.name.toLowerCase().includes(testSearch.toLowerCase()))
                  .map(t => {
                    const isAdding = addingTestId === t.id;
                    return (
                      <div key={t.id}
                        onClick={() => { if (!addingTestId) void handleAddToTest(t.id); }}
                        style={{
                          display:'flex', alignItems:'center', justifyContent:'space-between',
                          padding:'12px 14px', borderRadius:'var(--admin-card-radius)', marginBottom:'6px',
                          border:'1.5px solid var(--admin-border)', backgroundColor:'white',
                          cursor: addingTestId ? 'not-allowed' : 'pointer',
                          transition:'border-color 0.15s, background-color 0.15s',
                        }}
                        onMouseEnter={e => { if (!addingTestId) { e.currentTarget.style.borderColor='var(--admin-accent)'; e.currentTarget.style.backgroundColor='var(--admin-accent-soft)'; } }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor='var(--admin-border)'; e.currentTarget.style.backgroundColor='white'; }}>
                        <div style={{ minWidth:0 }}>
                          <p style={{ fontSize:'14px', fontWeight:600, color:'var(--admin-text)', margin:'0 0 2px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {t.name}
                          </p>
                          <p style={{ fontSize:'11px', color:'var(--admin-text-subtle)', margin:0 }}>
                            {t.testCode} / {t.duration} min
                          </p>
                        </div>
                        {isAdding ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2" style={{ borderColor:'var(--admin-accent)', flexShrink:0 }} />
                        ) : (
                          <Plus width={16} height={16} stroke="var(--admin-accent)" strokeWidth={2.5} style={{ flexShrink:0 }} />
                        )}
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}

      {/* -- Behavioral Edit Modal -- */}
      {editBeh.open && (
        <div style={{ position:'fixed', inset:0, backgroundColor:'rgba(15, 23, 42, 0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50 }}
          onClick={() => setEditBeh(p => ({ ...p, open: false }))}>
          <div style={{ backgroundColor:'white', borderRadius:'var(--admin-card-radius)', padding:'28px', width:'540px', maxWidth:'90vw', boxShadow:'0 20px 60px rgba(31, 53, 86, 0.18)' }}
            onClick={e => e.stopPropagation()}>

            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'20px' }}>
              <h2 style={{ fontSize:'18px', fontWeight:700, color:'var(--admin-text)', margin:0 }}>Edit Behavioral Question</h2>
              <button onClick={() => setEditBeh(p => ({ ...p, open: false }))}
                style={{ border:'none', background:'none', fontSize:'22px', color:'var(--admin-text-subtle)', cursor:'pointer', lineHeight:1 }}>x</button>
            </div>

            <div style={{ marginBottom:'14px' }}>
              <label style={{ display:'block', fontSize:'11px', fontWeight:700, color:'var(--admin-text-muted)', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.05em' }}>
                Title <span style={{ color:'#EF4444' }}>*</span>
              </label>
              <input value={editBeh.title}
                onChange={e => setEditBeh(p => ({ ...p, title: e.target.value }))}
                style={{ width:'100%', padding:'10px 12px', borderRadius:'var(--admin-field-radius)', border:'1.5px solid var(--admin-border)', fontSize:'14px', color:'var(--admin-text)', outline:'none', boxSizing:'border-box' }}
                placeholder="Question title" />
            </div>

            <div style={{ marginBottom:'14px' }}>
              <label style={{ display:'block', fontSize:'11px', fontWeight:700, color:'var(--admin-text-muted)', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Description</label>
              <textarea value={editBeh.description}
                onChange={e => setEditBeh(p => ({ ...p, description: e.target.value }))}
                rows={3}
                style={{ width:'100%', padding:'10px 12px', borderRadius:'var(--admin-field-radius)', border:'1.5px solid var(--admin-border)', fontSize:'14px', color:'var(--admin-text)', outline:'none', resize:'none', boxSizing:'border-box' }}
                placeholder="Optional description" />
            </div>

            <div style={{ marginBottom:'14px' }}>
              <label style={{ display:'block', fontSize:'11px', fontWeight:700, color:'var(--admin-text-muted)', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Expected Answer</label>
              <textarea value={editBeh.expectedAnswer}
                onChange={e => setEditBeh(p => ({ ...p, expectedAnswer: e.target.value }))}
                rows={3}
                style={{ width:'100%', padding:'10px 12px', borderRadius:'var(--admin-field-radius)', border:'1.5px solid var(--admin-border)', fontSize:'14px', color:'var(--admin-text)', outline:'none', resize:'none', boxSizing:'border-box' }}
                placeholder="What a good answer looks like" />
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 80px 1fr', gap:'12px', marginBottom:'22px' }}>
              <div>
                <label style={{ display:'block', fontSize:'11px', fontWeight:700, color:'var(--admin-text-muted)', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Difficulty</label>
                <CustomSelect
                  value={editBeh.difficulty}
                  onChange={v => setEditBeh(p => ({ ...p, difficulty: v as Difficulty }))}
                  options={[{ value:'easy', label:'Easy' }, { value:'medium', label:'Medium' }, { value:'hard', label:'Hard' }]}
                  style={{ width:'100%' }}
                />
              </div>
              <div>
                <label style={{ display:'block', fontSize:'11px', fontWeight:700, color:'var(--admin-text-muted)', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Marks</label>
                <input type="number" value={editBeh.marks}
                  onChange={e => setEditBeh(p => ({ ...p, marks: Number(e.target.value) }))}
                  style={{ width:'100%', padding:'9px 10px', borderRadius:'var(--admin-field-radius)', border:'1.5px solid var(--admin-border)', fontSize:'13px', color:'var(--admin-text-muted)', outline:'none', boxSizing:'border-box' }} />
              </div>
              <div>
                <label style={{ display:'block', fontSize:'11px', fontWeight:700, color:'var(--admin-text-muted)', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Topic</label>
                <input value={editBeh.topic}
                  onChange={e => setEditBeh(p => ({ ...p, topic: e.target.value }))}
                  style={{ width:'100%', padding:'9px 12px', borderRadius:'var(--admin-field-radius)', border:'1.5px solid var(--admin-border)', fontSize:'13px', color:'var(--admin-text-muted)', outline:'none', boxSizing:'border-box' }}
                  placeholder="e.g. Leadership" />
              </div>
            </div>

            <div style={{ display:'flex', justifyContent:'flex-end', gap:'10px' }}>
              <button onClick={() => setEditBeh(p => ({ ...p, open: false }))}
                style={{ padding:'10px 20px', borderRadius:'var(--admin-control-radius)', border:'1.5px solid var(--admin-border)', backgroundColor:'white', fontSize:'14px', fontWeight:500, color:'var(--admin-text-muted)', cursor:'pointer' }}>
                Cancel
              </button>
              <button onClick={handleSaveBehavioral} disabled={savingBeh}
                style={{ padding:'10px 20px', borderRadius:'var(--admin-control-radius)', border:'none', backgroundColor: savingBeh ? 'var(--admin-accent-disabled)' : 'var(--admin-accent)', fontSize:'14px', fontWeight:600, color:'white', cursor: savingBeh ? 'not-allowed' : 'pointer' }}>
                {savingBeh ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
