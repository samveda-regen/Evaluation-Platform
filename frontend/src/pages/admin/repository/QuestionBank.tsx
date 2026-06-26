import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../../services/api';
import {
  CheckSquare,
  Code2,
  Brain,
  ToggleLeft,
  ToggleRight,
  LibraryBig,
  FileDown,
  Plus,
  ChevronDown,
  Search,
  Pencil,
} from 'lucide-react';
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
interface SidebarItem {
  id: string;
  label: string;
  category: RepositoryCategory | 'all';
  topic?: string;
}
const SIDEBAR_ITEMS: SidebarItem[] = [
  { id:'all',       label:'All questions', category:'all' },
  { id:'MCQ',       label:'MCQ',           category:'MCQ' },
  { id:'CODING',    label:'Coding',        category:'CODING' },
  { id:'BEHAVIORAL',label:'Behavioral',    category:'BEHAVIORAL' },
];

type Difficulty = 'easy' | 'medium' | 'hard';

/* -- Type helpers -- */
function isMCQ(q: RepositoryQuestion): q is RepositoryMCQQuestion { return q.repositoryCategory === 'MCQ'; }
function isCoding(q: RepositoryQuestion): q is RepositoryCodingQuestion { return q.repositoryCategory === 'CODING'; }

/* -- Question title -- */
function qTitle(q: RepositoryQuestion): string {
  if (isMCQ(q)) return q.questionText;
  return (q as { title: string }).title || '';
}

/* -- Type icon -- */
function TypeIcon({ cat }: { cat: RepositoryCategory }) {
  if (cat === 'MCQ') return (
    <div style={{ width:'32px', height:'32px', borderRadius:'8px', backgroundColor:'var(--admin-accent-soft)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
      <CheckSquare width={14} height={14} stroke="var(--admin-accent-hover)" strokeWidth={2} />
    </div>
  );
  if (cat === 'CODING') return (
    <div style={{ width:'32px', height:'32px', borderRadius:'8px', backgroundColor:'var(--admin-accent-soft)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
      <Code2 width={14} height={14} stroke="var(--admin-accent-hover)" strokeWidth={2} />
    </div>
  );
  return (
    <div style={{ width:'32px', height:'32px', borderRadius:'8px', backgroundColor:'var(--admin-accent-soft)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
      <Brain width={14} height={14} stroke="var(--admin-accent-hover)" strokeWidth={2} />
    </div>
  );
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
  const fromTestId: string | undefined = (location.state as { fromTestId?: string; fromTestName?: string } | null)?.fromTestId;
  const fromTestName: string | undefined = (location.state as { fromTestId?: string; fromTestName?: string } | null)?.fromTestName;

  /* -- State -- */
  const [activeItem,   setActiveItem]   = useState<SidebarItem>(SIDEBAR_ITEMS[0]);
  const [questions,    setQuestions]    = useState<RepositoryQuestion[]>([]);
  const [pagination,   setPagination]   = useState<Pagination | null>(null);
  const [counts,       setCounts]       = useState<Record<string, number>>({});
  const [loading,      setLoading]      = useState(true);
  const [page,         setPage]         = useState(1);
  const [search,       setSearch]       = useState('');
  const [draftSearch,  setDraftSearch]  = useState('');
  const [selectedDiffs,setSelectedDiffs]= useState<Set<Difficulty>>(new Set(['easy','medium','hard']));
  const [showNewDrop,  setShowNewDrop]  = useState(false);
  const [sortOrder,    setSortOrder]    = useState<'most-used'|'newest'|'marks'>('most-used');
  const dropRef = useRef<HTMLDivElement>(null);
  const [editBeh, setEditBeh] = useState({
    open: false, id: '', title: '', description: '', marks: 5,
    difficulty: 'medium' as Difficulty, topic: '', expectedAnswer: '',
  });
  const [savingBeh, setSavingBeh] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [skillSearch,    setSkillSearch]    = useState('');
  const [showAllSkills,  setShowAllSkills]  = useState(false);
  const [allQuestions,   setAllQuestions]   = useState<RepositoryQuestion[]>([]);

  /* add-to-test modal */
  const [addModal,       setAddModal]       = useState<{ q: RepositoryQuestion } | null>(null);
  const [testsList,      setTestsList]      = useState<Test[]>([]);
  const [testsLoading,   setTestsLoading]   = useState(false);
  const [addingTestId,   setAddingTestId]   = useState<string | null>(null);
  const [testSearch,     setTestSearch]     = useState('');

  /* close dropdown on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowNewDrop(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* load initial counts + all-questions snapshot for filter building */
  useEffect(() => {
    void loadCounts();
    void (async () => {
      try {
        const [r1, r2, r3] = await Promise.all([
          adminApi.getQuestionBankQuestions({ category:'MCQ',       page:1, limit:100 }),
          adminApi.getQuestionBankQuestions({ category:'CODING',    page:1, limit:100 }),
          adminApi.getQuestionBankQuestions({ category:'BEHAVIORAL',page:1, limit:100 }),
        ]);
        setAllQuestions([...r1.data.questions, ...r2.data.questions, ...r3.data.questions]);
      } catch { /* silent */ }
    })();
  }, []);

  /* reload questions on filter change */
  useEffect(() => {
    setPage(1);
  }, [activeItem, search, selectedDiffs, selectedSkills]);

  useEffect(() => {
    void loadQuestions();
  }, [activeItem, page, search]);

  const loadCounts = async () => {
    try {
      const [mcq, coding, beh] = await Promise.all([
        adminApi.getQuestionBankQuestions({ category:'MCQ',       page:1, limit:1 }),
        adminApi.getQuestionBankQuestions({ category:'CODING',    page:1, limit:1 }),
        adminApi.getQuestionBankQuestions({ category:'BEHAVIORAL',page:1, limit:1 }),
      ]);
      const m = mcq.data.pagination.total;
      const c = coding.data.pagination.total;
      const b = beh.data.pagination.total;
      setCounts({ all: m+c+b, MCQ: m, CODING: c, BEHAVIORAL: b });
    } catch { /* silent */ }
  };

  const loadQuestions = async () => {
    setLoading(true);
    try {
      if (activeItem.category === 'all') {
        const [r1, r2, r3] = await Promise.all([
          adminApi.getQuestionBankQuestions({ category:'MCQ',       page, limit:10, search:search||undefined }),
          adminApi.getQuestionBankQuestions({ category:'CODING',    page, limit:5,  search:search||undefined }),
          adminApi.getQuestionBankQuestions({ category:'BEHAVIORAL',page, limit:5,  search:search||undefined }),
        ]);
        const combined = [...r1.data.questions, ...r2.data.questions, ...r3.data.questions];
        const total    = r1.data.pagination.total + r2.data.pagination.total + r3.data.pagination.total;
        setQuestions(combined);
        setPagination({ page, limit:20, total, totalPages: Math.ceil(total/20) });
      } else {
        const { data } = await adminApi.getQuestionBankQuestions({
          category: activeItem.category as RepositoryCategory,
          page,
          limit: 20,
          search:    search    || undefined,
          topic:     activeItem.topic || undefined,
        });
        setQuestions(data.questions);
        setPagination(data.pagination);
        if (!activeItem.topic) {
          setCounts(prev => ({ ...prev, [activeItem.id]: data.pagination.total }));
        } else {
          setCounts(prev => ({ ...prev, [activeItem.id]: data.pagination.total }));
        }
      }
    } catch { toast.error('Failed to load questions'); }
    finally { setLoading(false); }
  };

  /* When any filter is active use the full allQuestions snapshot so pagination
     doesn't hide matching questions that aren't on the current page.        */
  const anyFilterActive = selectedSkills.size > 0 || selectedDiffs.size < 3;
  const filterBase: RepositoryQuestion[] = anyFilterActive
    ? (activeItem.category === 'all'
        ? allQuestions
        : allQuestions.filter(q => q.repositoryCategory === activeItem.category))
    : questions;

  const visibleQuestions = filterBase.filter(q => {
    if (!selectedDiffs.has(q.difficulty as Difficulty)) return false;
    if (selectedSkills.size === 0) return true;
    const qTopics = new Set<string>([
      ...(q.topic ? [q.topic] : []),
      ...q.tags,
    ]);
    return [...selectedSkills].some(s => qTopics.has(s));
  });

  const handleToggle = async (q: RepositoryQuestion) => {
    const nextEnabled = !q.isEnabled;
    const applyEnabledState = (items: RepositoryQuestion[]) =>
      items.map(item => item.id === q.id ? { ...item, isEnabled: nextEnabled } : item);

    try {
      if (q.isEnabled) {
        await adminApi.disableQuestionBankQuestion(q.id, activeItem.category === 'all' ? q.repositoryCategory : activeItem.category as RepositoryCategory);
        toast.success('Question disabled');
      } else {
        await adminApi.enableQuestionBankQuestion(q.id, activeItem.category === 'all' ? q.repositoryCategory : activeItem.category as RepositoryCategory);
        toast.success('Question enabled');
      }
      setQuestions(applyEnabledState);
      setAllQuestions(applyEnabledState);
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

  const handleEdit = (q: RepositoryQuestion) => {
    if (isMCQ(q)) {
      navigate(`/admin/mcq/${q.id}/edit`, { state: { question: q } });
    } else if (isCoding(q)) {
      navigate(`/admin/coding/${q.id}/edit`, { state: { question: q } });
    } else {
      navigate(`/admin/behavioral/${q.id}/edit`, { state: { question: q } });
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
      toast.success(`Added to test`);
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
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Failed to add question');
    } finally { setAddingTestId(null); }
  };

  const handleSaveBehavioral = async () => {
    if (!editBeh.title.trim()) { toast.error('Title required'); return; }
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

  const toggleDiff = (d: Difficulty) => {
    setSelectedDiffs(prev => {
      const next = new Set(prev);
      next.has(d) ? next.delete(d) : next.add(d);
      return next;
    });
  };

  const toggleSkill = (s: string) => {
    setSelectedSkills(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  };

  const skillsList = useMemo(() => {
    const src = activeItem.category === 'all'
      ? allQuestions
      : allQuestions.filter(q => q.repositoryCategory === activeItem.category);
    const cnt: Record<string, number> = {};
    src.forEach(q => {
      if (q.topic) cnt[q.topic] = (cnt[q.topic] || 0) + 1;
      q.tags.forEach(t => { cnt[t] = (cnt[t] || 0) + 1; });
    });
    return Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  }, [allQuestions, activeItem]);

  const filteredSkillsList = useMemo(() =>
    skillSearch.trim()
      ? skillsList.filter(s => s.name.toLowerCase().includes(skillSearch.toLowerCase()))
      : skillsList,
  [skillsList, skillSearch]);

  const diffCounts = useMemo(() => {
    const src = activeItem.category === 'all'
      ? allQuestions
      : allQuestions.filter(q => q.repositoryCategory === activeItem.category);
    return (['easy','medium','hard'] as Difficulty[]).reduce((acc, d) => {
      acc[d] = src.filter(q => q.difficulty === d).length;
      return acc;
    }, {} as Record<Difficulty, number>);
  }, [allQuestions, activeItem]);

  const totalShown = pagination?.total ?? visibleQuestions.length;

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
        </div>
      )}

      {/* -- HEADER -- */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color:'var(--admin-text)', margin:0 }}>Question Library</h1>
          <p className="text-sm mt-0.5" style={{ color:'var(--admin-text-muted)' }}>Reusable question bank across all tests.</p>
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
              onClick={() => setShowNewDrop(p=>!p)}
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
                {[
                  { label:'MCQ question',        icon:'MCQ', path:'/admin/mcq/new' },
                  { label:'Coding question',     icon:'</>', path:'/admin/coding/new' },
                  { label:'Behavioral question', icon:'BEH', path:'/admin/behavioral/new' },
                ].map(opt => (
                  <button key={opt.label} onClick={() => { setShowNewDrop(false); navigate(opt.path); }}
                    style={{ width:'100%', textAlign:'left', padding:'10px 14px', border:'none', backgroundColor:'white', fontSize:'13px', color:'var(--admin-text-muted)', cursor:'pointer', borderBottom:'1px solid var(--admin-border)', display:'flex', alignItems:'center', gap:'8px' }}
                    onMouseEnter={e=>(e.currentTarget.style.backgroundColor='rgba(31, 53, 86, 0.06)')}
                    onMouseLeave={e=>(e.currentTarget.style.backgroundColor='white')}>
                    <span style={{ fontSize:'11px', color:'var(--admin-text-subtle)', width:'22px' }}>{opt.icon}</span>
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* -- REPOSITORY LAYOUT -- */}
      <div style={{ display:'grid', gridTemplateColumns:'220px minmax(0, 1fr)', gap:'18px', alignItems:'start' }}>
        <aside style={{ display:'flex', flexDirection:'column', gap:'18px', position:'sticky', top:'16px' }}>
          <div>
            <p style={{ fontSize:'11px', fontWeight:700, color:'var(--admin-text-subtle)', margin:'0 0 8px', textTransform:'uppercase', letterSpacing:'0.04em' }}>Question Types</p>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              {SIDEBAR_ITEMS.map(item => {
                const isActive = activeItem.id === item.id;
                const cnt = item.id === 'all'
                  ? (counts.MCQ||0)+(counts.CODING||0)+(counts.BEHAVIORAL||0)
                  : counts[item.id];
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSidebarClick(item)}
                    style={{
                      minHeight:'34px', width:'100%', padding:'8px 10px', borderRadius:'var(--admin-control-radius)',
                      border: isActive ? '1px solid var(--admin-accent)' : '1px solid transparent',
                      backgroundColor: isActive ? 'var(--admin-accent)' : 'transparent',
                      color: isActive ? 'white' : 'var(--admin-text-muted)',
                      fontSize:'13px', fontWeight:600, cursor:'pointer',
                      display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', textAlign:'left',
                    }}
                    onMouseEnter={e=>{ if(!isActive) e.currentTarget.style.backgroundColor='var(--admin-hover)'; }}
                    onMouseLeave={e=>{ if(!isActive) e.currentTarget.style.backgroundColor='transparent'; }}>
                    <span>{item.label}</span>
                    {cnt !== undefined && (
                      <span style={{ fontSize:'11px', lineHeight:1.3, fontWeight:700, color: isActive ? 'rgba(255,255,255,0.86)' : 'var(--admin-text-subtle)' }}>{cnt}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p style={{ fontSize:'11px', fontWeight:700, color:'var(--admin-text-subtle)', margin:'0 0 8px', textTransform:'uppercase', letterSpacing:'0.04em' }}>Difficulty</p>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              {(['easy','medium','hard'] as Difficulty[]).map(d => {
                const selected = selectedDiffs.has(d);
                return (
                  <button
                    key={d}
                    onClick={() => toggleDiff(d)}
                    style={{
                      minHeight:'32px', padding:'7px 10px', borderRadius:'var(--admin-control-radius)',
                      border: '1px solid transparent',
                      backgroundColor: selected ? 'var(--admin-accent-soft)' : 'transparent',
                      color: selected ? 'var(--admin-accent-hover)' : 'var(--admin-text-muted)',
                      cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'8px',
                      fontSize:'12px', fontWeight:600,
                    }}>
                    <span style={{ display:'inline-flex', alignItems:'center', gap:'8px', minWidth:0 }}>
                      <input
                        type="checkbox"
                        checked={selected}
                        readOnly
                        tabIndex={-1}
                        style={{
                          width:'14px',
                          height:'14px',
                          margin:0,
                          flexShrink:0,
                          accentColor:'var(--admin-accent)',
                          pointerEvents:'none',
                        }}
                      />
                      <span style={{ textTransform:'capitalize' }}>{d}</span>
                    </span>
                    <span style={{ color: selected ? 'var(--admin-accent-hover)' : 'var(--admin-text-subtle)' }}>{diffCounts[d] || 0}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* -- MAIN CONTENT -- */}
        <main style={{ minWidth:0 }}>
          {/* Search + count + sort */}
          <div style={{
            display:'grid',
            gridTemplateColumns:'minmax(260px, 1fr) auto auto',
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
                const uses = usageCount(q);
                const rate = correctRate(q);
                const catLabel = cat === 'MCQ' ? 'MCQ' : cat === 'CODING' ? 'Coding' : 'Behavioral';
                return (
                  <div key={q.id} style={{
                    display:'flex', alignItems:'center', gap:'14px',
                    backgroundColor: q.isEnabled ? 'white' : 'var(--admin-accent-soft)',
                    borderRadius:'var(--admin-card-radius)', padding:'11px 14px',
                    boxShadow:'var(--admin-card-shadow)',
                    border: q.isEnabled ? '1px solid transparent' : '1px solid var(--admin-accent-disabled)',
                    transition:'box-shadow 0.15s',
                  }}
                    onMouseEnter={e=>(e.currentTarget.style.boxShadow='0 2px 8px rgba(31, 53, 86, 0.12)')}
                    onMouseLeave={e=>(e.currentTarget.style.boxShadow='var(--admin-card-shadow)')}>

                    {/* Type icon */}
                    <TypeIcon cat={cat} />

                    {/* Question content */}
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontSize:'14px', fontWeight:600, color:'var(--admin-text)', margin:'0 0 6px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {qTitle(q)}
                      </p>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:'5px', alignItems:'center' }}>
                        <Badge label={catLabel} {...META_BADGE_CFG} />
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
                    <div style={{ display:'flex', alignItems:'center', gap:'12px', flexShrink:0 }}>
                      {/* Uses */}
                      <div style={{ textAlign:'right' }}>
                        <p style={{ fontSize:'15px', fontWeight:700, color:'var(--admin-text)', margin:0, lineHeight:1 }}>{uses}</p>
                        <p style={{ fontSize:'10px', color:'var(--admin-text-subtle)', margin:'2px 0 0' }}>uses</p>
                      </div>
                      {/* Correct % */}
                      {rate && (
                        <div style={{ textAlign:'right' }}>
                          <p style={{ fontSize:'15px', fontWeight:700, color:'var(--admin-accent)', margin:0, lineHeight:1 }}>{rate}</p>
                          <p style={{ fontSize:'10px', color:'var(--admin-text-subtle)', margin:'2px 0 0' }}>correct</p>
                        </div>
                      )}
                      {/* Marks (when no rate) */}
                      {!rate && (
                        <div style={{ textAlign:'right' }}>
                          <p style={{ fontSize:'15px', fontWeight:700, color:'var(--admin-text-muted)', margin:0, lineHeight:1 }}>{q.marks}</p>
                          <p style={{ fontSize:'10px', color:'var(--admin-text-subtle)', margin:'2px 0 0' }}>marks</p>
                        </div>
                      )}
                      {/* Add to test */}
                      {(() => {
                        const isAddingThis = fromTestId
                          ? addingTestId === fromTestId + q.id
                          : false;
                        return (
                          <button
                            type="button"
                            onClick={() => fromTestId ? void handleAddDirectToTest(q, fromTestId) : openAddToTest(q)}
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
                <input type="number" min={1} value={editBeh.marks}
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
