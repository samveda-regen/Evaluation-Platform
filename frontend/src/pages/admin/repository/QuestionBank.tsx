import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../../services/api';
import {
  ArrowLeft,
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
  Check,
  Pencil,
} from 'lucide-react';
import Icon from '../../../components/Icon';
import CustomSelect from '../../../components/CustomSelect';
import type {
  Pagination,
  RepositoryCategory,
  RepositoryCodingQuestion,
  RepositoryMCQQuestion,
  RepositoryQuestion,
  Test,
} from '../../../types';

/* ── Sidebar item types ── */
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

/* ── Type helpers ── */
function isMCQ(q: RepositoryQuestion): q is RepositoryMCQQuestion { return q.repositoryCategory === 'MCQ'; }
function isCoding(q: RepositoryQuestion): q is RepositoryCodingQuestion { return q.repositoryCategory === 'CODING'; }

/* ── Question title ── */
function qTitle(q: RepositoryQuestion): string {
  if (isMCQ(q)) return q.questionText;
  return (q as { title: string }).title || '';
}

/* ── Type icon — gradient orange theme ── */
function TypeIcon({ cat }: { cat: RepositoryCategory }) {
  if (cat === 'MCQ') return (
    <div style={{ width:'38px', height:'38px', borderRadius:'10px', background:'linear-gradient(135deg,#F59E0B,#D97706)', boxShadow:'0 2px 6px rgba(245,158,11,0.35)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
      <CheckSquare width={18} height={18} stroke="white" strokeWidth={2} />
    </div>
  );
  if (cat === 'CODING') return (
    <div style={{ width:'38px', height:'38px', borderRadius:'10px', background:'linear-gradient(135deg,#FB923C,#F59E0B)', boxShadow:'0 2px 6px rgba(251,146,60,0.35)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
      <Code2 width={18} height={18} stroke="white" strokeWidth={2} />
    </div>
  );
  return (
    <div style={{ width:'38px', height:'38px', borderRadius:'10px', background:'linear-gradient(135deg,#D97706,#B45309)', boxShadow:'0 2px 6px rgba(180,83,9,0.3)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
      <Brain width={18} height={18} stroke="white" strokeWidth={2} />
    </div>
  );
}

/* ── Difficulty badge ── */
const DIFF_CFG: Record<Difficulty, { bg: string; color: string }> = {
  easy:   { bg:'#FFFBEB', color:'#D97706' },
  medium: { bg:'#FEF3C7', color:'#D97706' },
  hard:   { bg:'#FEF2F2', color:'#DC2626' },
};
const CAT_CFG: Record<RepositoryCategory, { bg: string; color: string }> = {
  MCQ:        { bg:'#FFFBEB', color:'#D97706' },
  CODING:     { bg:'#FFF7ED', color:'#C2410C' },
  BEHAVIORAL: { bg:'#FEF3C7', color:'#92400E' },
};
function Badge({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <span style={{ fontSize:'11px', fontWeight:500, padding:'2px 8px', borderRadius:'20px', backgroundColor:bg, color, whiteSpace:'nowrap' }}>
      {label}
    </span>
  );
}

/* ── Toggle icon ── */
function ToggleIcon({ enabled }: { enabled: boolean }) {
  return enabled
    ? <ToggleRight width={22} height={22} stroke="#F59E0B" strokeWidth={1.5} />
    : <ToggleLeft  width={22} height={22} stroke="#D1D5DB" strokeWidth={1.5} />;
}

export default function QuestionBank() {
  const navigate = useNavigate();
  const location = useLocation();

  // If navigated from a test's "Add from Library" button, these will be set
  const fromTestId: string | undefined = (location.state as { fromTestId?: string; fromTestName?: string } | null)?.fromTestId;
  const fromTestName: string | undefined = (location.state as { fromTestId?: string; fromTestName?: string } | null)?.fromTestName;

  /* ── State ── */
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
  const [showSortDrop, setShowSortDrop] = useState(false);
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
    try {
      if (q.isEnabled) {
        await adminApi.disableQuestionBankQuestion(q.id, activeItem.category === 'all' ? q.repositoryCategory : activeItem.category as RepositoryCategory);
        toast.success('Question disabled');
      } else {
        await adminApi.enableQuestionBankQuestion(q.id, activeItem.category === 'all' ? q.repositoryCategory : activeItem.category as RepositoryCategory);
        toast.success('Question enabled');
      }
      void loadQuestions();
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

  // Direct add — used when coming from a specific test's "Add from Library" button
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
    return n != null ? String(n) : '—';
  };
  const correctRate = (q: RepositoryQuestion): string | null => {
    const r = q as unknown as Record<string, number>;
    const n = r.correctRate ?? r.avgCorrectRate ?? r.correctPercentage ?? null;
    return n != null ? `${Math.round(n)}%` : null;
  };

  return (
    <div style={{ backgroundColor:'#F9FAFB', minHeight:'100%' }}>

      {/* ── "Adding to test" banner ── */}
      {fromTestId && (
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'10px 16px', marginBottom:'16px', borderRadius:'10px',
          backgroundColor:'#FFFBEB', border:'1.5px solid #FDE68A',
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
            <LibraryBig width={16} height={16} stroke="#D97706" strokeWidth={1.5} />
            <span style={{ fontSize:'13px', color:'#D97706', fontWeight:500 }}>
              Adding questions to: <strong>{fromTestName ?? 'test'}</strong>
              <span style={{ color:'#F59E0B', fontWeight:400, marginLeft:'6px' }}>— click Add on any question to add it directly</span>
            </span>
          </div>
        </div>
      )}

      {/* ── Breadcrumb ── */}
      <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', color:'#98A2B5', marginBottom:'16px' }}>
        <span style={{ cursor:'pointer', color:'#6A7387' }} onClick={() => navigate('/admin/dashboard')}>Workspace</span>
        <span>›</span>
        <span>Question Library</span>
      </div>

      {/* ── HEADER ── */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:'20px' }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:'12px' }}>
          {/* Back button */}
          <button
            onClick={() => navigate(-1)}
            title="Go back"
            className="back-circle-btn"
            style={{
              width:'34px', height:'34px', borderRadius:'50%', border:'1.5px solid #FDE68A',
              backgroundColor:'white', display:'flex', alignItems:'center', justifyContent:'center',
              cursor:'pointer', flexShrink:0, marginTop:'4px',
              transition:'background-color 0.18s, border-color 0.18s, transform 0.18s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.backgroundColor = 'rgba(245,158,11,0.1)';
              e.currentTarget.style.borderColor = '#F59E0B';
              e.currentTarget.style.transform = 'scale(1.1)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.backgroundColor = 'white';
              e.currentTarget.style.borderColor = '#FDE68A';
              e.currentTarget.style.transform = 'scale(1)';
            }}
            onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.93)'; }}
            onMouseUp={e => { e.currentTarget.style.transform = 'scale(1.1)'; }}
          >
            <ArrowLeft width={15} height={15} stroke="#D97706" strokeWidth={2} />
          </button>

          <div>
            <h1 style={{ fontSize:'32px', fontWeight:700, letterSpacing:'-0.02em', color:'#11162A', margin:'0 0 4px', lineHeight:1.2 }}>Question Library</h1>
            <p style={{ fontSize:'13px', color:'#6A7387', margin:0 }}>Reusable question bank across all tests.</p>
          </div>
        </div>

        <div style={{ display:'flex', gap:'8px', flexShrink:0, alignItems:'center' }}>
          {/* Import CSV */}
          <button
            onClick={() => toast('CSV import coming soon', { icon:'📂' })}
            style={{
              display:'flex', alignItems:'center', gap:'5px', padding:'8px 16px',
              border:'1.5px solid #E5E7EB', borderRadius:'9px', backgroundColor:'white',
              fontSize:'13px', fontWeight:500, color:'#434B5E', cursor:'pointer',
            }}>
            <FileDown width={14} height={14} strokeWidth={2} color="#F59E0B" />
            Import CSV
          </button>

          {/* New question with dropdown */}
          <div ref={dropRef} style={{ position:'relative' }}>
            <div style={{ display:'flex', borderRadius:'9px', overflow:'hidden' }}>
              <button
                onClick={() => navigate('/admin/mcq/new')}
                style={{
                  display:'flex', alignItems:'center', gap:'5px', padding:'8px 16px',
                  border:'none', backgroundColor:'#F59E0B', fontSize:'13px', fontWeight:600,
                  color:'white', cursor:'pointer',
                }}>
                <Plus width={13} height={13} stroke="white" strokeWidth={2.5} />
                New question
              </button>
              <button
                onClick={() => setShowNewDrop(p=>!p)}
                style={{
                  padding:'8px 10px', border:'none', borderLeft:'1px solid #D97706',
                  backgroundColor:'#F59E0B', color:'white', cursor:'pointer',
                }}>
                <ChevronDown width={12} height={12} stroke="white" strokeWidth={2} />
              </button>
            </div>
            {showNewDrop && (
              <div style={{
                position:'absolute', top:'100%', right:0, marginTop:'4px', zIndex:30,
                backgroundColor:'white', borderRadius:'10px', boxShadow:'0 8px 24px rgba(0,0,0,0.12)',
                border:'1px solid #E5E7EB', minWidth:'160px', overflow:'hidden',
              }}>
                {[
                  { label:'MCQ question',        icon:'≡',   path:'/admin/mcq/new' },
                  { label:'Coding question',     icon:'</>',  path:'/admin/coding/new' },
                  { label:'Behavioral question', icon:'💬',   path:'/admin/behavioral/new' },
                ].map(opt => (
                  <button key={opt.label} onClick={() => { setShowNewDrop(false); navigate(opt.path); }}
                    style={{ width:'100%', textAlign:'left', padding:'10px 14px', border:'none', backgroundColor:'white', fontSize:'13px', color:'#434B5E', cursor:'pointer', borderBottom:'1px solid #F3F4F6', display:'flex', alignItems:'center', gap:'8px' }}
                    onMouseEnter={e=>(e.currentTarget.style.backgroundColor='rgba(245,158,11,0.06)')}
                    onMouseLeave={e=>(e.currentTarget.style.backgroundColor='white')}>
                    <span style={{ fontSize:'11px', color:'#98A2B5', width:'22px' }}>{opt.icon}</span>
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 2-COLUMN LAYOUT ── */}
      <div style={{ display:'grid', gridTemplateColumns:'180px 1fr', gap:'20px', alignItems:'start' }}>

        {/* ── LEFT SIDEBAR ── */}
        <div style={{ minWidth:0, position:'sticky', top:0, maxHeight:'calc(100vh - 140px)', overflowY:'auto', paddingRight:'4px' }}>
          {/* CATEGORIES */}
          <p style={{ fontSize:'10px', fontWeight:700, color:'#98A2B5', letterSpacing:'0.08em', margin:'0 0 8px', paddingLeft:'4px' }}>
            CATEGORIES
          </p>
          {SIDEBAR_ITEMS.map(item => {
            const isActive = activeItem.id === item.id;
            const cnt = item.id === 'all'
              ? (counts.MCQ||0)+(counts.CODING||0)+(counts.BEHAVIORAL||0)
              : counts[item.id];
            return (
              <button key={item.id} onClick={() => handleSidebarClick(item)}
                style={{
                  width:'100%', textAlign:'left', padding:'8px 10px', border:'none', borderRadius:'8px',
                  backgroundColor: isActive ? '#F59E0B' : 'transparent',
                  color: isActive ? 'white' : '#434B5E',
                  fontSize:'13px', fontWeight: isActive ? 600 : 400,
                  cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between',
                  marginBottom:'2px', transition:'background-color 0.12s',
                }}
                onMouseEnter={e=>{ if(!isActive) e.currentTarget.style.backgroundColor='rgba(245,158,11,0.08)'; }}
                onMouseLeave={e=>{ if(!isActive) e.currentTarget.style.backgroundColor='transparent'; }}>
                <span style={{ display:'flex', alignItems:'center', gap:'7px' }}>
                  {item.id === 'MCQ'       && <Icon name="mcq-questions"          size={19} style={{ opacity: isActive ? 1 : 0.65 }} />}
                  {item.id === 'CODING'    && <Icon name="coding"                 size={19} style={{ opacity: isActive ? 1 : 0.65 }} />}
                  {item.id === 'BEHAVIORAL'&& <Icon name="behavioural-questions"  size={19} style={{ opacity: isActive ? 1 : 0.65 }} />}
                  {item.id === 'all'       && <Icon name="question-library"       size={19} style={{ opacity: isActive ? 1 : 0.65 }} />}
                  {item.label}
                </span>
                {cnt !== undefined && (
                  <span style={{
                    fontSize:'11px', padding:'1px 7px', borderRadius:'20px', fontWeight:600,
                    backgroundColor: isActive ? 'rgba(255,255,255,0.25)' : '#F3F4F6',
                    color: isActive ? 'white' : '#6A7387',
                  }}>{cnt}</span>
                )}
              </button>
            );
          })}

          {/* FILTERS section */}
          <div style={{ height:'1px', backgroundColor:'#E5E7EB', margin:'16px 0 12px' }} />
          <p style={{ fontSize:'10px', fontWeight:700, color:'#98A2B5', letterSpacing:'0.08em', margin:'0 0 12px', paddingLeft:'4px' }}>
            FILTERS
          </p>

          {/* Skills filter */}
          <div style={{ marginBottom:'16px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'7px' }}>
              <span style={{ fontSize:'12px', fontWeight:600, color:'#434B5E' }}>Skills</span>
              {selectedSkills.size > 0 && (
                <button onClick={() => setSelectedSkills(new Set())}
                  style={{ fontSize:'11px', fontWeight:500, color:'#F59E0B', border:'none', background:'none', cursor:'pointer', padding:0 }}>
                  Clear
                </button>
              )}
            </div>
            <div style={{ position:'relative', marginBottom:'6px' }}>
              <Search style={{ position:'absolute', left:'7px', top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}
                width={11} height={11} stroke="#98A2B5" strokeWidth={1.5} />
              <input
                value={skillSearch}
                onChange={e => setSkillSearch(e.target.value)}
                placeholder="Search skills..."
                style={{
                  width:'100%', padding:'5px 8px 5px 23px', borderRadius:'7px',
                  border:'1px solid #E5E7EB', backgroundColor:'white', fontSize:'11px',
                  color:'#434B5E', outline:'none', boxSizing:'border-box',
                }}
              />
            </div>
            {filteredSkillsList.slice(0, showAllSkills ? undefined : 8).map(skill => (
              <label key={skill.name} onClick={() => toggleSkill(skill.name)}
                style={{ display:'flex', alignItems:'center', gap:'7px', padding:'3px 10px', cursor:'pointer', borderRadius:'6px', marginBottom:'1px' }}
                onMouseEnter={e=>(e.currentTarget.style.backgroundColor='rgba(245,158,11,0.08)')}
                onMouseLeave={e=>(e.currentTarget.style.backgroundColor='transparent')}>
                <div style={{
                  width:'14px', height:'14px', borderRadius:'3px', flexShrink:0,
                  border: selectedSkills.has(skill.name) ? '2px solid #F59E0B' : '2px solid #D1D5DB',
                  backgroundColor: selectedSkills.has(skill.name) ? '#F59E0B' : 'white',
                  display:'flex', alignItems:'center', justifyContent:'center',
                }}>
                  {selectedSkills.has(skill.name) && (
                    <Check width={8} height={8} stroke="white" strokeWidth={2.5} />
                  )}
                </div>
                <span style={{ fontSize:'12px', color:'#434B5E', flex:1, userSelect:'none', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{skill.name}</span>
                <span style={{ fontSize:'11px', color:'#98A2B5', flexShrink:0 }}>({skill.count})</span>
              </label>
            ))}
            {filteredSkillsList.length === 0 && skillSearch.trim() && (
              <p style={{ fontSize:'11px', color:'#98A2B5', padding:'4px 10px', margin:0 }}>No skills found</p>
            )}
            {!skillSearch.trim() && filteredSkillsList.length === 0 && (
              <p style={{ fontSize:'11px', color:'#98A2B5', padding:'4px 10px', margin:0 }}>No topics yet</p>
            )}
            {filteredSkillsList.length > 8 && (
              <button onClick={() => setShowAllSkills(v=>!v)}
                style={{ marginTop:'4px', marginLeft:'10px', fontSize:'11px', color:'#F59E0B', border:'none', background:'none', cursor:'pointer', padding:0, fontWeight:500 }}>
                {showAllSkills ? '− Show less' : `+ ${filteredSkillsList.length - 8} more`}
              </button>
            )}
          </div>

          {/* Difficulty filter */}
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'7px' }}>
              <span style={{ fontSize:'12px', fontWeight:600, color:'#434B5E' }}>Difficulty</span>
              {selectedDiffs.size < 3 && (
                <button onClick={() => setSelectedDiffs(new Set(['easy','medium','hard']))}
                  style={{ fontSize:'11px', fontWeight:500, color:'#F59E0B', border:'none', background:'none', cursor:'pointer', padding:0 }}>
                  Clear
                </button>
              )}
            </div>
            {(['easy','medium','hard'] as Difficulty[]).map(d => (
              <label key={d} onClick={() => toggleDiff(d)}
                style={{ display:'flex', alignItems:'center', gap:'7px', padding:'3px 10px', cursor:'pointer', borderRadius:'6px', marginBottom:'1px' }}
                onMouseEnter={e=>(e.currentTarget.style.backgroundColor='rgba(245,158,11,0.08)')}
                onMouseLeave={e=>(e.currentTarget.style.backgroundColor='transparent')}>
                <div style={{
                  width:'14px', height:'14px', borderRadius:'3px', flexShrink:0,
                  border: selectedDiffs.has(d) ? '2px solid #F59E0B' : '2px solid #D1D5DB',
                  backgroundColor: selectedDiffs.has(d) ? '#F59E0B' : 'white',
                  display:'flex', alignItems:'center', justifyContent:'center',
                }}>
                  {selectedDiffs.has(d) && (
                    <Check width={8} height={8} stroke="white" strokeWidth={2.5} />
                  )}
                </div>
                <span style={{ fontSize:'12px', color:'#434B5E', textTransform:'capitalize', flex:1, userSelect:'none' }}>{d}</span>
                <span style={{ fontSize:'11px', color:'#98A2B5', flexShrink:0 }}>({diffCounts[d] || 0})</span>
              </label>
            ))}
          </div>
        </div>

        {/* ── RIGHT MAIN CONTENT ── */}
        <div>
          {/* Search + count + sort */}
          <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'14px' }}>
            {/* Search */}
            <div style={{ position:'relative', flex:1 }}>
              <Search style={{ position:'absolute', left:'12px', top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}
                width={14} height={14} stroke="#98A2B5" strokeWidth={1.5} />
              <input
                value={draftSearch}
                onChange={e => setDraftSearch(e.target.value)}
                onKeyDown={e => { if (e.key==='Enter') { setSearch(draftSearch); setPage(1); } }}
                placeholder="Search questions..."
                style={{
                  width:'100%', padding:'9px 12px 9px 36px', borderRadius:'9px',
                  border:'1px solid #E5E7EB', backgroundColor:'white', fontSize:'13px',
                  color:'#434B5E', outline:'none', boxSizing:'border-box',
                }}
              />
            </div>
            {/* Count badge */}
            <div style={{ padding:'6px 14px', borderRadius:'20px', backgroundColor:'#F3F4F6', fontSize:'12px', fontWeight:500, color:'#434B5E', whiteSpace:'nowrap', flexShrink:0 }}>
              {loading ? '…' : totalShown} questions
            </div>
            {/* Sort */}
            {showSortDrop && <div className="fixed inset-0 z-20" onClick={() => setShowSortDrop(false)} />}
            <div style={{ position:'relative', flexShrink:0, zIndex:21 }}>
              <button
                onClick={() => setShowSortDrop(v => !v)}
                style={{
                  display:'flex', alignItems:'center', gap:'6px', padding:'8px 12px',
                  borderRadius:'9px', border:'1px solid #E5E7EB', backgroundColor:'white',
                  fontSize:'13px', color:'#434B5E', cursor:'pointer', whiteSpace:'nowrap',
                }}>
                {sortOrder === 'most-used' ? 'Most used' : sortOrder === 'newest' ? 'Newest' : 'By marks'}
                <ChevronDown width={13} height={13} stroke="#98A2B5" strokeWidth={2} />
              </button>
              {showSortDrop && (
                <div style={{
                  position:'absolute', right:0, top:'calc(100% + 6px)', zIndex:30,
                  backgroundColor:'white', borderRadius:'10px', padding:'4px',
                  boxShadow:'0 8px 24px rgba(0,0,0,0.12)', border:'1px solid #E5E7EB', minWidth:'140px',
                }}>
                  {([['most-used','Most used'],['newest','Newest'],['marks','By marks']] as const).map(([val, label]) => (
                    <button key={val}
                      onClick={() => { setSortOrder(val); setShowSortDrop(false); }}
                      style={{
                        width:'100%', textAlign:'left', padding:'8px 12px', border:'none',
                        borderRadius:'7px', fontSize:'13px', cursor:'pointer',
                        backgroundColor: sortOrder === val ? '#F59E0B' : 'transparent',
                        color: sortOrder === val ? 'white' : '#434B5E',
                        fontWeight: sortOrder === val ? 600 : 400,
                      }}
                      onMouseEnter={e => { if (sortOrder !== val) e.currentTarget.style.backgroundColor = 'rgba(245,158,11,0.08)'; }}
                      onMouseLeave={e => { if (sortOrder !== val) e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >{label}</button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Question list */}
          {loading ? (
            <div style={{ display:'flex', justifyContent:'center', padding:'60px 0' }}>
              <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor:'#F59E0B' }} />
            </div>
          ) : visibleQuestions.length === 0 ? (
            <div style={{ textAlign:'center', padding:'60px 0', color:'#98A2B5', fontSize:'14px' }}>
              No questions found
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
              {visibleQuestions.map(q => {
                const cat  = q.repositoryCategory;
                const diff = q.difficulty as Difficulty;
                const uses = usageCount(q);
                const rate = correctRate(q);
                const catLabel = cat === 'MCQ' ? 'MCQ' : cat === 'CODING' ? 'Coding' : 'Behavioral';
                return (
                  <div key={q.id} style={{
                    display:'flex', alignItems:'center', gap:'14px',
                    backgroundColor: q.isEnabled ? 'white' : '#FFF5F5',
                    borderRadius:'12px', padding:'14px 18px',
                    boxShadow:'0 1px 3px rgba(0,0,0,0.05)',
                    border: q.isEnabled ? '1px solid transparent' : '1px solid #FECACA',
                    transition:'box-shadow 0.15s',
                  }}
                    onMouseEnter={e=>(e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.09)')}
                    onMouseLeave={e=>(e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,0.05)')}>

                    {/* Type icon */}
                    <TypeIcon cat={cat} />

                    {/* Question content */}
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontSize:'14px', fontWeight:600, color:'#11162A', margin:'0 0 6px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {qTitle(q)}
                      </p>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:'5px', alignItems:'center' }}>
                        <Badge label={catLabel} {...CAT_CFG[cat]} />
                        <Badge label={diff.charAt(0).toUpperCase()+diff.slice(1)} {...DIFF_CFG[diff]} />
                        {q.topic && (
                          <span style={{ fontSize:'11px', color:'#6A7387', padding:'2px 8px', borderRadius:'20px', backgroundColor:'#F3F4F6' }}>
                            {q.topic}
                          </span>
                        )}
                        {q.tags.slice(0,2).map(tag => (
                          <span key={tag} style={{ fontSize:'11px', color:'#6A7387', padding:'2px 8px', borderRadius:'20px', backgroundColor:'#F3F4F6' }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Stats */}
                    <div style={{ display:'flex', alignItems:'center', gap:'16px', flexShrink:0 }}>
                      {/* Uses */}
                      <div style={{ textAlign:'right' }}>
                        <p style={{ fontSize:'15px', fontWeight:700, color:'#11162A', margin:0, lineHeight:1 }}>{uses}</p>
                        <p style={{ fontSize:'10px', color:'#98A2B5', margin:'2px 0 0' }}>uses</p>
                      </div>
                      {/* Correct % */}
                      {rate && (
                        <div style={{ textAlign:'right' }}>
                          <p style={{ fontSize:'15px', fontWeight:700, color:'#F59E0B', margin:0, lineHeight:1 }}>{rate}</p>
                          <p style={{ fontSize:'10px', color:'#98A2B5', margin:'2px 0 0' }}>correct</p>
                        </div>
                      )}
                      {/* Marks (when no rate) */}
                      {!rate && (
                        <div style={{ textAlign:'right' }}>
                          <p style={{ fontSize:'15px', fontWeight:700, color:'#6A7387', margin:0, lineHeight:1 }}>{q.marks}</p>
                          <p style={{ fontSize:'10px', color:'#98A2B5', margin:'2px 0 0' }}>marks</p>
                        </div>
                      )}
                      {/* Add to test */}
                      {(() => {
                        const isAddingThis = fromTestId
                          ? addingTestId === fromTestId + q.id
                          : false;
                        return (
                          <button
                            onClick={() => fromTestId ? void handleAddDirectToTest(q, fromTestId) : openAddToTest(q)}
                            disabled={isAddingThis}
                            title={fromTestId ? `Add to ${fromTestName ?? 'test'}` : 'Add to test'}
                            style={{ padding:'6px 10px', borderRadius:'7px', border:'1.5px solid #FEF3C7', backgroundColor:'#FFFBEB', cursor: isAddingThis ? 'not-allowed' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:'4px', fontSize:'12px', fontWeight:600, color:'#D97706', opacity: isAddingThis ? 0.6 : 1 }}>
                            {isAddingThis ? (
                              <div className="animate-spin rounded-full h-3 w-3 border-b-2" style={{ borderColor:'#D97706' }} />
                            ) : (
                              <Plus width={13} height={13} stroke="#D97706" strokeWidth={2.5} />
                            )}
                            Add
                          </button>
                        );
                      })()}
                      {/* Toggle enable/disable */}
                      <button onClick={() => handleToggle(q)}
                        title={q.isEnabled ? 'Disable question' : 'Enable question'}
                        style={{ padding:'4px 6px', borderRadius:'7px', border:'none', backgroundColor:'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                        <ToggleIcon enabled={q.isEnabled} />
                      </button>
                      {/* Edit */}
                      <button onClick={() => handleEdit(q)}
                        title="Edit question"
                        style={{ padding:'6px 10px', borderRadius:'7px', border:'1.5px solid #E5E7EB', backgroundColor:'white', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:'4px', fontSize:'12px', fontWeight:500, color:'#434B5E' }}>
                        <Pencil width={13} height={13} stroke="#6A7387" strokeWidth={1.5} />
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
                style={{ padding:'7px 16px', borderRadius:'8px', border:'1.5px solid #E5E7EB', backgroundColor:'white', fontSize:'13px', color: page===1?'#98A2B5':'#434B5E', cursor: page===1?'not-allowed':'pointer' }}>
                Previous
              </button>
              <span style={{ fontSize:'13px', color:'#6A7387' }}>Page {page} of {pagination.totalPages}</span>
              <button onClick={() => setPage(p=>Math.min(pagination.totalPages,p+1))} disabled={page===pagination.totalPages}
                style={{ padding:'7px 16px', borderRadius:'8px', border:'1.5px solid #E5E7EB', backgroundColor:'white', fontSize:'13px', color: page===pagination.totalPages?'#98A2B5':'#434B5E', cursor: page===pagination.totalPages?'not-allowed':'pointer' }}>
                Next
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Add to Test Modal ── */}
      {addModal && (
        <div style={{ position:'fixed', inset:0, backgroundColor:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50 }}
          onClick={() => setAddModal(null)}>
          <div style={{ backgroundColor:'white', borderRadius:'16px', padding:'28px', width:'480px', maxWidth:'90vw', maxHeight:'80vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'6px' }}>
              <h2 style={{ fontSize:'18px', fontWeight:700, color:'#11162A', margin:0 }}>Add to Test</h2>
              <button onClick={() => setAddModal(null)}
                style={{ border:'none', background:'none', fontSize:'22px', color:'#98A2B5', cursor:'pointer', lineHeight:1 }}>×</button>
            </div>
            <p style={{ fontSize:'13px', color:'#6A7387', margin:'0 0 16px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {qTitle(addModal.q)}
            </p>

            {/* Search tests */}
            <div style={{ position:'relative', marginBottom:'12px' }}>
              <Search style={{ position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}
                width={13} height={13} stroke="#98A2B5" strokeWidth={1.5} />
              <input
                value={testSearch}
                onChange={e => setTestSearch(e.target.value)}
                placeholder="Search tests..."
                style={{
                  width:'100%', padding:'8px 12px 8px 32px', borderRadius:'9px',
                  border:'1.5px solid #E5E7EB', backgroundColor:'#F9FAFB',
                  fontSize:'13px', color:'#434B5E', outline:'none', boxSizing:'border-box',
                }}
              />
            </div>

            {/* Test list */}
            <div style={{ overflowY:'auto', flex:1 }}>
              {testsLoading ? (
                <div style={{ display:'flex', justifyContent:'center', padding:'32px 0' }}>
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor:'#F59E0B' }} />
                </div>
              ) : testsList.length === 0 ? (
                <p style={{ textAlign:'center', color:'#98A2B5', fontSize:'13px', padding:'32px 0' }}>No tests found</p>
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
                          padding:'12px 14px', borderRadius:'10px', marginBottom:'6px',
                          border:'1.5px solid #E5E7EB', backgroundColor:'white',
                          cursor: addingTestId ? 'not-allowed' : 'pointer',
                          transition:'border-color 0.15s, background-color 0.15s',
                        }}
                        onMouseEnter={e => { if (!addingTestId) { e.currentTarget.style.borderColor='#F59E0B'; e.currentTarget.style.backgroundColor='#FFFBEB'; } }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor='#E5E7EB'; e.currentTarget.style.backgroundColor='white'; }}>
                        <div style={{ minWidth:0 }}>
                          <p style={{ fontSize:'14px', fontWeight:600, color:'#11162A', margin:'0 0 2px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {t.name}
                          </p>
                          <p style={{ fontSize:'11px', color:'#98A2B5', margin:0 }}>
                            {t.testCode} · {t.duration} min
                          </p>
                        </div>
                        {isAdding ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2" style={{ borderColor:'#F59E0B', flexShrink:0 }} />
                        ) : (
                          <Plus width={16} height={16} stroke="#F59E0B" strokeWidth={2.5} style={{ flexShrink:0 }} />
                        )}
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Behavioral Edit Modal ── */}
      {editBeh.open && (
        <div style={{ position:'fixed', inset:0, backgroundColor:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50 }}
          onClick={() => setEditBeh(p => ({ ...p, open: false }))}>
          <div style={{ backgroundColor:'white', borderRadius:'16px', padding:'28px', width:'540px', maxWidth:'90vw', boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}
            onClick={e => e.stopPropagation()}>

            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'20px' }}>
              <h2 style={{ fontSize:'18px', fontWeight:700, color:'#11162A', margin:0 }}>Edit Behavioral Question</h2>
              <button onClick={() => setEditBeh(p => ({ ...p, open: false }))}
                style={{ border:'none', background:'none', fontSize:'22px', color:'#98A2B5', cursor:'pointer', lineHeight:1 }}>×</button>
            </div>

            <div style={{ marginBottom:'14px' }}>
              <label style={{ display:'block', fontSize:'11px', fontWeight:700, color:'#6A7387', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.05em' }}>
                Title <span style={{ color:'#EF4444' }}>*</span>
              </label>
              <input value={editBeh.title}
                onChange={e => setEditBeh(p => ({ ...p, title: e.target.value }))}
                style={{ width:'100%', padding:'10px 12px', borderRadius:'10px', border:'1.5px solid #E5E7EB', fontSize:'14px', color:'#11162A', outline:'none', boxSizing:'border-box' }}
                placeholder="Question title" />
            </div>

            <div style={{ marginBottom:'14px' }}>
              <label style={{ display:'block', fontSize:'11px', fontWeight:700, color:'#6A7387', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Description</label>
              <textarea value={editBeh.description}
                onChange={e => setEditBeh(p => ({ ...p, description: e.target.value }))}
                rows={3}
                style={{ width:'100%', padding:'10px 12px', borderRadius:'10px', border:'1.5px solid #E5E7EB', fontSize:'14px', color:'#11162A', outline:'none', resize:'none', boxSizing:'border-box' }}
                placeholder="Optional description" />
            </div>

            <div style={{ marginBottom:'14px' }}>
              <label style={{ display:'block', fontSize:'11px', fontWeight:700, color:'#6A7387', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Expected Answer</label>
              <textarea value={editBeh.expectedAnswer}
                onChange={e => setEditBeh(p => ({ ...p, expectedAnswer: e.target.value }))}
                rows={3}
                style={{ width:'100%', padding:'10px 12px', borderRadius:'10px', border:'1.5px solid #E5E7EB', fontSize:'14px', color:'#11162A', outline:'none', resize:'none', boxSizing:'border-box' }}
                placeholder="What a good answer looks like" />
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 80px 1fr', gap:'12px', marginBottom:'22px' }}>
              <div>
                <label style={{ display:'block', fontSize:'11px', fontWeight:700, color:'#6A7387', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Difficulty</label>
                <CustomSelect
                  value={editBeh.difficulty}
                  onChange={v => setEditBeh(p => ({ ...p, difficulty: v as Difficulty }))}
                  options={[{ value:'easy', label:'Easy' }, { value:'medium', label:'Medium' }, { value:'hard', label:'Hard' }]}
                  style={{ width:'100%' }}
                />
              </div>
              <div>
                <label style={{ display:'block', fontSize:'11px', fontWeight:700, color:'#6A7387', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Marks</label>
                <input type="number" min={1} value={editBeh.marks}
                  onChange={e => setEditBeh(p => ({ ...p, marks: Number(e.target.value) }))}
                  style={{ width:'100%', padding:'9px 10px', borderRadius:'10px', border:'1.5px solid #E5E7EB', fontSize:'13px', color:'#434B5E', outline:'none', boxSizing:'border-box' }} />
              </div>
              <div>
                <label style={{ display:'block', fontSize:'11px', fontWeight:700, color:'#6A7387', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Topic</label>
                <input value={editBeh.topic}
                  onChange={e => setEditBeh(p => ({ ...p, topic: e.target.value }))}
                  style={{ width:'100%', padding:'9px 12px', borderRadius:'10px', border:'1.5px solid #E5E7EB', fontSize:'13px', color:'#434B5E', outline:'none', boxSizing:'border-box' }}
                  placeholder="e.g. Leadership" />
              </div>
            </div>

            <div style={{ display:'flex', justifyContent:'flex-end', gap:'10px' }}>
              <button onClick={() => setEditBeh(p => ({ ...p, open: false }))}
                style={{ padding:'10px 20px', borderRadius:'10px', border:'1.5px solid #E5E7EB', backgroundColor:'white', fontSize:'14px', fontWeight:500, color:'#434B5E', cursor:'pointer' }}>
                Cancel
              </button>
              <button onClick={handleSaveBehavioral} disabled={savingBeh}
                style={{ padding:'10px 20px', borderRadius:'10px', border:'none', backgroundColor: savingBeh ? '#FDE68A' : '#F59E0B', fontSize:'14px', fontWeight:600, color:'white', cursor: savingBeh ? 'not-allowed' : 'pointer' }}>
                {savingBeh ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
