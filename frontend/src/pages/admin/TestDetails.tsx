import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { Test, MCQQuestion, CodingQuestion } from '../../types';
import TestCandidatesPanel from './TestCandidatesPanel';
import TestAIProctoring from './TestAIProctoring';
import TestSettings from './TestSettings';
import BackButton from '../../components/BackButton';
import {
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ClipboardCheck,
  Layers,
  Timer,
  FileQuestion,
  Users,
  LayoutDashboard,
  ShieldCheck,
  Settings2,
  Search,
  Plus,
  LibraryBig,
  Trash2,
  Eye,
  CheckSquare,
  Code2,
  Brain,
  CheckCircle2,
  X,
  Link2,
  Upload,
} from 'lucide-react';

interface InvitationSummary {
  total: number;
  sent: number;
  failed: number;
}

interface BehavioralQuestion {
  id: string;
  title: string;
  description: string;
  marks: number;
  expectedAnswer?: string;
}

interface TestQuestion {
  id: string;
  questionType: 'mcq' | 'coding' | 'behavioral' | string;
  orderIndex: number;
  sectionId?: string | null;
  mcqQuestion?: MCQQuestion;
  codingQuestion?: CodingQuestion;
  behavioralQuestion?: BehavioralQuestion;
}

interface TestSection {
  id: string;
  name: string;
  orderIndex: number;
  questionsPerCandidate: number;
  questions: TestQuestion[];
}

interface CodingTestCaseForm {
  input: string;
  expectedOutput: string;
  isHidden: boolean;
  marks: number;
}

interface TestAnalytics {
  totalAttempts: number;
  completedAttempts: number;
  averageScore: number | null;
  passRate: number | null;
  averageTrustScore: number | null;
  scoreDistribution: Record<string, number> | null;
  highestScore: number | null;
  medianScore: number | null;
  lowestScore: number | null;
  flaggedAttempts: number | null;
}

type ActiveTab = 'overview' | 'questions' | 'candidates' | 'ai-proctoring' | 'settings';

function getTestStatus(test: Test): 'Published' | 'Draft' | 'Scheduled' | 'Archived' {
  const now = new Date();
  if (test.endTime && new Date(test.endTime) < now) return 'Archived';
  if (!test.isActive) return 'Draft';
  if (new Date(test.startTime) > now) return 'Scheduled';
  return 'Published';
}

const SCORE_BANDS = ['0-40', '40-55', '55-70', '70-85', '85-100'];

/* ── Build display buckets — always show all 5 bands, defaulting to 0 ── */
function buildBuckets(dist: Record<string, number> | null, _totalMarks: number) {
  const source = dist ?? {};
  return SCORE_BANDS.map(label => ({ label, count: source[label] ?? 0 }));
}

/* ── Bar colour based on which percentage band it falls in vs passing score ── */
function bandColor(label: string, passingPct: number): string {
  const upper = parseInt(label.split('-')[1] ?? '100', 10);
  const lower = parseInt(label.split('-')[0] ?? '0', 10);
  if (upper <= passingPct - 15) return '#F87171'; // clearly failing → red
  if (lower < passingPct)       return '#FCD34D'; // borderline → amber
  return '#10B981';                                // passing → green
}

/* ── Score distribution bar chart ── */
function ScoreBarChart({
  buckets,
  passingPct,
  passRate,
}: {
  buckets: { label: string; count: number }[];
  passingPct: number;
  passRate: number | null;
}) {
  const max = Math.max(...buckets.map(b => b.count), 1);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '8px', height: '140px' }}>
        {buckets.map(b => {
          const heightPct = b.count > 0 ? (b.count / max) * 100 : 0;
          const color = b.count > 0 ? bandColor(b.label, passingPct) : '#E5E7EB';
          return (
            <div key={b.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '64px', gap: '6px', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', width: '100%', height: '100px' }}>
                <div style={{
                  width: '100%',
                  height: `${Math.max(heightPct, 4)}%`,
                  backgroundColor: color,
                  borderRadius: '5px 5px 0 0',
                  transition: 'height 0.3s',
                }} />
              </div>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#374151' }}>{b.label}</span>
              <span style={{ fontSize: '11px', color: '#6B7280' }}>{b.count}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #F3F4F6' }}>
        <span style={{ fontSize: '13px', color: '#6B7280' }}>
          Passing score&nbsp;<strong style={{ color: '#111827' }}>{passingPct}%</strong>
        </span>
        <span style={{ fontSize: '13px', color: '#6B7280' }}>
          Pass rate&nbsp;<strong style={{ color: '#10B981' }}>{passRate != null ? Math.round(passRate) : 0}%</strong>
        </span>
      </div>
    </div>
  );
}

export default function TestDetails() {
  const { testId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [test, setTest] = useState<Test | null>(null);
  const [questions, setQuestions] = useState<TestQuestion[]>([]);
  const [sections, setSections] = useState<TestSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<TestAnalytics | null>(null);

  /* tab — sync from ?tab= URL param */
  const tabParam = searchParams.get('tab') as ActiveTab | null;
  const [activeTab, setActiveTab] = useState<ActiveTab>(
    tabParam === 'candidates' || tabParam === 'questions' || tabParam === 'ai-proctoring' || tabParam === 'settings' ? tabParam : 'overview'
  );

  const switchTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === 'overview') { next.delete('tab'); } else { next.set('tab', tab); }
    next.delete('view');
    setSearchParams(next, { replace: true });
  };

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [invitationFile, setInvitationFile] = useState<File | null>(null);
  const [customMessage, setCustomMessage] = useState('');
  const [sendingInvitations, setSendingInvitations] = useState(false);
  const [invitationSummary, setInvitationSummary] = useState<InvitationSummary | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [questionType, setQuestionType] = useState<'mcq' | 'coding' | 'behavioral'>('mcq');
  const [availableQuestions, setAvailableQuestions] = useState<
    (MCQQuestion | CodingQuestion | BehavioralQuestion)[]
  >([]);
  const [selectedQuestion, setSelectedQuestion] = useState('');
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  const [showSectionModal, setShowSectionModal] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [creatingSection, setCreatingSection] = useState(false);

  const [showCustomModal, setShowCustomModal] = useState(false);
  const [savingCustom, setSavingCustom] = useState(false);
  const [customType, setCustomType] = useState<'mcq' | 'coding' | 'behavioral'>('mcq');
  const [customMarks, setCustomMarks] = useState(5);
  const [customDifficulty, setCustomDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [customTopic, setCustomTopic] = useState('');
  const [customTags, setCustomTags] = useState('');

  const [customMCQ, setCustomMCQ] = useState({
    questionText: '', options: ['', '', '', ''], correctAnswers: '',
    isMultipleChoice: false, explanation: ''
  });
  const [customCoding, setCustomCoding] = useState({
    title: '', description: '', inputFormat: '', outputFormat: '', constraints: '',
    sampleInput: '', sampleOutput: '', supportedLanguages: 'python,javascript',
    timeLimit: 2000, memoryLimit: 256, partialScoring: false
  });
  const [customCodingTestCases, setCustomCodingTestCases] = useState<CodingTestCaseForm[]>([
    { input: '', expectedOutput: '', isHidden: false, marks: 0 }
  ]);
  const [customBehavioral, setCustomBehavioral] = useState({ title: '', description: '', expectedAnswer: '' });

  /* ── Questions tab UI state ── */
  const [qSearch, setQSearch] = useState('');
  const [qTypeFilter, setQTypeFilter] = useState('all');
  const [qDiffFilter, setQDiffFilter] = useState('all');
  const [qPage, setQPage] = useState(1);
  const [selectedQIds, setSelectedQIds] = useState<Set<string>>(new Set());
  const [showNewQMenu, setShowNewQMenu] = useState(false);
  const Q_PAGE_SIZE = 10;

  useEffect(() => { loadTest(); loadAnalytics(); }, [testId]);

  const loadTest = async () => {
    try {
      const { data } = await adminApi.getTest(testId!);
      setTest(data.test);
      setQuestions(data.test.questions || []);
      setSections(data.test.sections || []);
    } catch { toast.error('Failed to load test'); }
    finally { setLoading(false); }
  };

  const loadAnalytics = async () => {
    try {
      const { data } = await adminApi.getTestAnalytics(testId!);
      if (data.success && data.analytics) setAnalytics(data.analytics);
    } catch { /* no analytics yet */ }
  };

  const handlePublish = async () => {
    if (!test) return;
    if (test.isActive) {
      toast.success('Changes are live');
      return;
    }
    try {
      await adminApi.updateTest(test.id, { isActive: true });
      setTest(prev => prev ? { ...prev, isActive: true } : prev);
      toast.success('Test published successfully');
    } catch { toast.error('Failed to publish test'); }
  };

  const openInviteModal = () => {
    setShowInviteModal(true); setInvitationFile(null);
    setCustomMessage(''); setInvitationSummary(null);
  };
  const closeInviteModal = () => {
    if (sendingInvitations) return;
    setShowInviteModal(false); setInvitationFile(null);
    setCustomMessage(''); setInvitationSummary(null);
  };

  const handleSendInvitations = async () => {
    if (!testId || !invitationFile) { toast.error('Please upload a CSV or XLSX file'); return; }
    const formData = new FormData();
    formData.append('file', invitationFile);
    if (customMessage.trim()) formData.append('customMessage', customMessage.trim());
    setSendingInvitations(true); setInvitationSummary(null);
    try {
      const { data } = await adminApi.sendInvitations(testId, formData);
      setInvitationSummary(data);
      toast.success(data.failed > 0 && data.sent > 0
        ? `Partial: ${data.sent} sent, ${data.failed} failed`
        : 'Invitation batch completed');
    } catch (error: unknown) {
      const e = error as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Failed to send invitations');
    } finally { setSendingInvitations(false); }
  };

  const loadAvailableQuestions = async (type: 'mcq' | 'coding' | 'behavioral') => {
    try {
      if (type === 'mcq') { const { data } = await adminApi.getMCQs(1, 100); setAvailableQuestions(data.questions); }
      else if (type === 'coding') { const { data } = await adminApi.getCodings(1, 100); setAvailableQuestions(data.questions); }
      else { const { data } = await adminApi.getBehaviorals(1, 100); setAvailableQuestions(data.questions); }
    } catch { toast.error('Failed to load questions'); }
  };

  const handleCreateSection = async () => {
    if (!newSectionName.trim()) { toast.error('Section name is required'); return; }
    setCreatingSection(true);
    try {
      await adminApi.createTestSection(testId!, { name: newSectionName.trim() });
      toast.success('Section created'); setShowSectionModal(false); setNewSectionName('');
      await loadTest();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to create section');
    } finally { setCreatingSection(false); }
  };

  const handleDeleteSection = async (sectionId: string) => {
    if (!confirm('Delete this section and remove its questions from the test?')) return;
    try {
      await adminApi.deleteTestSection(testId!, sectionId);
      toast.success('Section deleted'); await loadTest();
    } catch { toast.error('Failed to delete section'); }
  };

  const handleAddQuestion = async () => {
    if (!selectedQuestion) { toast.error('Please select a question'); return; }
    try {
      await adminApi.addQuestionToTest(testId!, { questionId: selectedQuestion, questionType, sectionId: activeSectionId || undefined });
      toast.success('Question added to test');
      setShowAddModal(false); setSelectedQuestion(''); setActiveSectionId(null);
      loadTest();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to add question');
    }
  };

  const handleRemoveQuestion = async (questionId: string) => {
    if (!confirm('Remove this question from the test?')) return;
    try {
      await adminApi.removeQuestionFromTest(testId!, questionId);
      toast.success('Question removed'); loadTest();
    } catch { toast.error('Failed to remove question'); }
  };

  const openAddModal = (type: 'mcq' | 'coding' | 'behavioral', sectionId?: string | null) => {
    setQuestionType(type); setShowAddModal(true); setSelectedQuestion('');
    setAvailableQuestions([]); setActiveSectionId(sectionId ?? null);
    loadAvailableQuestions(type);
  };

  const resetCustomForm = () => {
    setCustomType('mcq'); setCustomMarks(5); setCustomDifficulty('medium');
    setCustomTopic(''); setCustomTags('');
    setCustomMCQ({ questionText: '', options: ['', '', '', ''], correctAnswers: '', isMultipleChoice: false, explanation: '' });
    setCustomCoding({ title: '', description: '', inputFormat: '', outputFormat: '', constraints: '', sampleInput: '', sampleOutput: '', supportedLanguages: 'python,javascript', timeLimit: 2000, memoryLimit: 256, partialScoring: false });
    setCustomCodingTestCases([{ input: '', expectedOutput: '', isHidden: false, marks: 0 }]);
    setCustomBehavioral({ title: '', description: '', expectedAnswer: '' });
  };

  const handleOpenCustomModal = (sectionId?: string | null, initialType: 'mcq' | 'coding' | 'behavioral' = 'mcq') => {
    resetCustomForm(); setShowCustomModal(true); setActiveSectionId(sectionId ?? null);
    setCustomType(initialType);
  };

  const handleDuplicateSelected = () => {
    toast('Open a question individually to duplicate it.');
  };

  const handleRemoveSelected = async () => {
    const ids = [...selectedQIds];
    if (ids.length === 0) return;
    if (!confirm(`Remove ${ids.length} question(s) from this test?`)) return;
    try {
      for (const qId of ids) {
        await adminApi.removeQuestionFromTest(testId!, qId);
      }
      setSelectedQIds(new Set());
      toast.success(`${ids.length} question(s) removed`);
      await loadTest();
    } catch { toast.error('Failed to remove some questions'); }
  };

  const setMCQOption = (index: number, value: string) =>
    setCustomMCQ(prev => { const options = [...prev.options]; options[index] = value; return { ...prev, options }; });
  const addMCQOption = () =>
    setCustomMCQ(prev => prev.options.length >= 6 ? prev : { ...prev, options: [...prev.options, ''] });
  const removeMCQOption = (index: number) =>
    setCustomMCQ(prev => prev.options.length <= 2 ? prev : { ...prev, options: prev.options.filter((_, idx) => idx !== index) });

  const setCodingTestCaseField = <K extends keyof CodingTestCaseForm>(index: number, key: K, value: CodingTestCaseForm[K]) =>
    setCustomCodingTestCases(prev => prev.map((tc, idx) => idx === index ? { ...tc, [key]: value } : tc));
  const addCodingTestCase = () =>
    setCustomCodingTestCases(prev => [...prev, { input: '', expectedOutput: '', isHidden: false, marks: 0 }]);
  const removeCodingTestCase = (index: number) =>
    setCustomCodingTestCases(prev => prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== index));

  const parseTagInput = () => customTags.split(',').map(t => t.trim()).filter(t => t.length > 0);

  const handleAddCustomQuestion = async () => {
    if (!testId) return;
    setSavingCustom(true);
    try {
      const common = { marks: customMarks, difficulty: customDifficulty, topic: customTopic.trim() || undefined, tags: parseTagInput(), sectionId: activeSectionId || undefined };
      if (customType === 'mcq') {
        const cleanedOptions = customMCQ.options.map(o => o.trim()).filter(o => o.length > 0);
        const correctAnswers = customMCQ.correctAnswers.split(',').map(i => parseInt(i.trim(), 10)).filter(i => Number.isInteger(i) && i > 0).map(i => i - 1);
        await adminApi.addCustomQuestionToTest(testId, { questionType: 'mcq', questionText: customMCQ.questionText, options: cleanedOptions, correctAnswers, isMultipleChoice: customMCQ.isMultipleChoice, explanation: customMCQ.explanation.trim() || undefined, ...common });
      } else if (customType === 'coding') {
        const supportedLanguages = customCoding.supportedLanguages.split(',').map(l => l.trim().toLowerCase()).filter(l => l.length > 0);
        const testCases = customCodingTestCases.map(tc => ({ input: tc.input, expectedOutput: tc.expectedOutput, isHidden: tc.isHidden, marks: tc.marks })).filter(tc => tc.input.trim().length > 0 && tc.expectedOutput.trim().length > 0);
        await adminApi.addCustomQuestionToTest(testId, { questionType: 'coding', title: customCoding.title, description: customCoding.description, inputFormat: customCoding.inputFormat, outputFormat: customCoding.outputFormat, constraints: customCoding.constraints.trim() || undefined, sampleInput: customCoding.sampleInput, sampleOutput: customCoding.sampleOutput, supportedLanguages, timeLimit: customCoding.timeLimit, memoryLimit: customCoding.memoryLimit, partialScoring: customCoding.partialScoring, testCases, ...common });
      } else {
        await adminApi.addCustomQuestionToTest(testId, { questionType: 'behavioral', title: customBehavioral.title, description: customBehavioral.description, expectedAnswer: customBehavioral.expectedAnswer.trim() || undefined, ...common });
      }
      toast.success('Custom question added to test');
      setShowCustomModal(false); resetCustomForm(); setActiveSectionId(null);
      await loadTest();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string; errors?: Array<{ msg?: string }> } } };
      toast.error(err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || 'Failed to add custom question');
    } finally { setSavingCustom(false); }
  };

  const activeSection = activeSectionId ? sections.find(s => s.id === activeSectionId) || null : null;
  const unsectionedQuestions = questions.filter(q => !q.sectionId);

  const getQuestionKey = (q: TestQuestion) => {
    if (q.questionType === 'mcq' && q.mcqQuestion?.id) return `mcq:${q.mcqQuestion.id}`;
    if (q.questionType === 'coding' && q.codingQuestion?.id) return `coding:${q.codingQuestion.id}`;
    if (q.questionType === 'behavioral' && q.behavioralQuestion?.id) return `behavioral:${q.behavioralQuestion.id}`;
    return null;
  };

  const sectionUsageMap = sections.reduce((map, section, index) => {
    (section.questions || []).forEach(q => {
      const key = getQuestionKey(q);
      if (!key) return;
      const existing = map.get(key) || [];
      if (!existing.includes(index + 1)) existing.push(index + 1);
      map.set(key, existing);
    });
    return map;
  }, new Map<string, number[]>());

  const selectedQuestionUsage = selectedQuestion ? sectionUsageMap.get(`${questionType}:${selectedQuestion}`) || null : null;

  const typeCoverageWarning = (() => {
    if (sections.length === 0) return null;
    const targetTypes = ['mcq', 'coding', 'behavioral'] as const;
    type SectionType = typeof targetTypes[number];
    const sectionTypeMap = sections.map(section => {
      const typeSet = new Set<SectionType>();
      (section.questions || []).forEach(q => { if (q.questionType === 'mcq' || q.questionType === 'coding' || q.questionType === 'behavioral') typeSet.add(q.questionType); });
      return { id: section.id, typeSet };
    });
    const emptySections = sections.map((s, i) => ({ count: (s.questions || []).length, number: i + 1 })).filter(s => s.count === 0).map(s => s.number);
    if (emptySections.length > 0) return `Warning: Section${emptySections.length > 1 ? 's' : ''} ${emptySections.join(', ')} have no questions.`;
    const sectionsByType = new Map<SectionType, string[]>();
    targetTypes.forEach(type => { sectionsByType.set(type, sectionTypeMap.filter(s => s.typeSet.has(type)).map(s => s.id)); });
    const assignedTypeBySection = new Map<string, SectionType>();
    const assignedSectionByType = new Map<SectionType, string>();
    const typesByScarcity = [...targetTypes].sort((a, b) => (sectionsByType.get(a)?.length || 0) - (sectionsByType.get(b)?.length || 0));
    const tryAssign = (type: SectionType, visited: Set<string>): boolean => {
      for (const sectionId of sectionsByType.get(type) || []) {
        if (visited.has(sectionId)) continue;
        visited.add(sectionId);
        const currentType = assignedTypeBySection.get(sectionId);
        if (!currentType || tryAssign(currentType, visited)) {
          assignedTypeBySection.set(sectionId, type); assignedSectionByType.set(type, sectionId); return true;
        }
      }
      return false;
    };
    for (const type of typesByScarcity) tryAssign(type, new Set<string>());
    if (assignedSectionByType.size === targetTypes.length) return null;
    return 'Warning: Question types are unbalanced across sections.';
  })();

  /* ── Questions-tab computed values ── */
  const allFlatQuestions = [...unsectionedQuestions, ...sections.flatMap(s => s.questions || [])];
  const qTextOf = (q: TestQuestion): string =>
    (q.questionType === 'mcq' ? q.mcqQuestion?.questionText
      : q.questionType === 'coding' ? q.codingQuestion?.title
      : q.behavioralQuestion?.title) || '';
  const qDiffOf = (q: TestQuestion): string =>
    (((q.mcqQuestion as any)?.difficulty || (q.codingQuestion as any)?.difficulty || (q.behavioralQuestion as any)?.difficulty) || 'medium').toLowerCase();
  const qMarksOf = (q: TestQuestion): number =>
    q.mcqQuestion?.marks || q.codingQuestion?.marks || q.behavioralQuestion?.marks || 0;
  const filteredQs = allFlatQuestions.filter(q => {
    const matchSearch = !qSearch || qTextOf(q).toLowerCase().includes(qSearch.toLowerCase());
    const matchType = qTypeFilter === 'all' || q.questionType === qTypeFilter;
    const matchDiff = qDiffFilter === 'all' || qDiffOf(q) === qDiffFilter;
    return matchSearch && matchType && matchDiff;
  });
  const totalQPages = Math.ceil(filteredQs.length / Q_PAGE_SIZE);
  const pagedQs = filteredQs.slice((qPage - 1) * Q_PAGE_SIZE, qPage * Q_PAGE_SIZE);
  const totalQPoints = filteredQs.reduce((s, q) => s + qMarksOf(q), 0);

  if (loading) {
    return (
      <div style={{ backgroundColor: '#f4f6fb', margin: '-24px', padding: '24px', minHeight: 'calc(100vh - 52px)' }} className="flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: '#10B981' }} />
      </div>
    );
  }
  if (!test) return <div className="text-center py-12" style={{ color: '#6B7280' }}>Test not found</div>;

  const status = getTestStatus(test);
  const mcqCount       = questions.filter(q => q.questionType === 'mcq').length;
  const codingCount    = questions.filter(q => q.questionType === 'coding').length;
  const behavioralCount = questions.filter(q => q.questionType === 'behavioral').length;
  const compMax        = Math.max(mcqCount, codingCount, behavioralCount, 1);

  const totalAttempts = analytics?.totalAttempts ?? test._count?.attempts ?? 0;
  const completionPct = analytics && analytics.totalAttempts > 0
    ? Math.round((analytics.completedAttempts / analytics.totalAttempts) * 100)
    : 0;
  const avgScore = analytics?.averageScore != null && test.totalMarks
    ? Math.round((analytics.averageScore / test.totalMarks) * 100)
    : null;
  const avgTrust      = analytics?.averageTrustScore != null ? Math.round(analytics.averageTrustScore) : null;
  const passRatePct   = analytics?.passRate != null ? Math.round(analytics.passRate) : null;
  const passingPct    = test.passingMarks && test.totalMarks ? Math.round((test.passingMarks / test.totalMarks) * 100) : 60;
  const buckets       = buildBuckets(analytics?.scoreDistribution ?? null, test.totalMarks);

  const statusColors: Record<string, { bg: string; color: string; dot: string }> = {
    Published: { bg: '#ECFDF5', color: '#059669', dot: '#10B981' },
    Draft:     { bg: '#F3F4F6', color: '#6B7280', dot: '#9CA3AF' },
    Scheduled: { bg: '#EFF6FF', color: '#1D4ED8', dot: '#3B82F6' },
    Archived:  { bg: '#FFF7ED', color: '#C2410C', dot: '#F97316' },
  };
  const sc = statusColors[status];

  const TABS: { id: ActiveTab | 'ai-proctoring' | 'settings'; label: string; icon: React.ReactNode }[] = [
    {
      id: 'overview', label: 'Overview',
      icon: <LayoutDashboard size={14} />,
    },
    {
      id: 'questions', label: 'Questions',
      icon: <FileQuestion size={14} />,
    },
    {
      id: 'candidates', label: 'Candidates',
      icon: <Users size={14} />,
    },
    {
      id: 'ai-proctoring', label: 'AI Proctoring',
      icon: <ShieldCheck size={14} />,
    },
    {
      id: 'settings', label: 'Settings',
      icon: <Settings2 size={14} />,
    },
  ];

  return (
    <div style={{ backgroundColor: '#f4f6fb', margin: '-24px', padding: '24px', minHeight: 'calc(100vh - 52px)' }}>

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm mb-5" style={{ color: '#9CA3AF' }}>
        <BackButton mt="0" />
        <Link to="/admin/tests" className="hover:underline" style={{ color: '#9CA3AF' }}>Assessments</Link>
        <ChevronRight size={12} />
        <span style={{ color: '#374151' }}>{test.name}</span>
      </div>

      {/* Header */}
      <div className="rounded-2xl p-5 mb-5" style={{ backgroundColor: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          {/* Left: icon + name + meta */}
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)', boxShadow: '0 3px 10px rgba(79,70,229,0.35)' }}>
              <Layers size={22} color="white" strokeWidth={1.8} />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold" style={{ color: '#111827' }}>{test.name}</h1>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
                  style={{ backgroundColor: sc.bg, color: sc.color }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: sc.dot }} />
                  {status}
                </span>
              </div>
              <div className="flex items-center gap-4 mt-1.5 text-sm flex-wrap" style={{ color: '#6B7280' }}>
                <span className="font-mono font-semibold" style={{ color: '#374151' }}>{test.testCode}</span>
                <span className="flex items-center gap-1">
                  <Timer size={12} />
                  {test.duration} min
                </span>
                <span className="flex items-center gap-1">
                  <FileQuestion size={12} />
                  {test._count?.questions ?? questions.length} questions
                </span>
                <span className="flex items-center gap-1">
                  <Users size={12} />
                  {totalAttempts} attempts
                </span>
              </div>
            </div>
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              className="flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium"
              style={{ borderColor: '#E5E7EB', color: '#374151', backgroundColor: 'white', transition: 'background-color 0.15s, border-color 0.15s' }}
              onClick={() => window.open(`/admin/tests/${testId}/preview`, '_blank')}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#EDF0F7'; (e.currentTarget as HTMLElement).style.borderColor = '#C7CEDF'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'white'; (e.currentTarget as HTMLElement).style.borderColor = '#E5E7EB'; }}
            >
              <Eye size={14} />
              Preview
            </button>
            <button
              onClick={openInviteModal}
              className="flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium"
              style={{ borderColor: '#E5E7EB', color: '#374151', backgroundColor: 'white', transition: 'background-color 0.15s, border-color 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#EDF0F7'; (e.currentTarget as HTMLElement).style.borderColor = '#C7CEDF'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'white'; (e.currentTarget as HTMLElement).style.borderColor = '#E5E7EB'; }}
            >
              <Link2 size={14} />
              Invite link
              {totalAttempts > 0 && (
                <span className="h-5 w-5 rounded-full text-xs font-bold flex items-center justify-center" style={{ backgroundColor: '#F3F4F6', color: '#374151' }}>
                  {Math.min(totalAttempts, 9)}
                </span>
              )}
            </button>
            <button
              onClick={handlePublish}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: '#10B981' }}
            >
              <Upload size={14} color="white" />
              {test.isActive ? 'Publish changes' : 'Publish'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mt-5 pt-4" style={{ borderTop: '1px solid #F3F4F6' }}>
          {TABS.map(tab => {
            const isNavTab = false;
            if (isNavTab) {
              return (
                <Link
                  key={tab.id}
                  to={`/admin/tests/${testId}/${tab.id}`}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
                  style={{ color: '#6B7280' }}
                >
                  {tab.icon}{tab.label}
                </Link>
              );
            }
            return (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id as ActiveTab)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  backgroundColor: activeTab === tab.id ? '#F0FDF4' : 'white',
                  color: activeTab === tab.id ? '#059669' : '#6B7280',
                  border: activeTab === tab.id ? '1.5px solid #A7F3D0' : '1.5px solid #E5E7EB',
                }}
              >
                {tab.icon}{tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ═══════════════ OVERVIEW TAB ═══════════════ */}
      {activeTab === 'overview' && (
        <div className="grid lg:grid-cols-[1fr_280px] gap-5">
          {/* Left */}
          <div className="space-y-5">
            {/* 4 stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Attempts', value: totalAttempts.toString(), icon: <Users size={20} color="#10B981" /> },
                { label: 'Completion', value: completionPct > 0 ? `${completionPct}%` : '—', icon: <CheckCircle2 size={20} color="#3B82F6" /> },
                { label: 'Avg score',  value: avgScore != null ? `${avgScore}%` : '—', icon: <ClipboardCheck size={20} color="#8B5CF6" /> },
                { label: 'Avg trust',  value: avgTrust != null ? `${avgTrust}%` : '—', icon: <ShieldCheck size={20} color="#F59E0B" /> },
              ].map(card => (
                <div key={card.label} className="rounded-2xl p-5" style={{ backgroundColor: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
                  <div className="mb-3">{card.icon}</div>
                  <p className="text-3xl font-bold" style={{ color: '#111827' }}>{card.value}</p>
                  <p className="text-sm mt-1" style={{ color: '#6B7280' }}>{card.label}</p>
                </div>
              ))}
            </div>

            {/* Score Statistics */}
            {analytics && analytics.completedAttempts > 0 && (analytics.highestScore != null || analytics.medianScore != null || analytics.lowestScore != null) && (
              <div className="rounded-2xl p-6" style={{ backgroundColor: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
                <h3 className="text-base font-semibold mb-5" style={{ color: '#111827' }}>Score Statistics</h3>
                <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
                  {[
                    { label: 'Highest', value: analytics.highestScore != null ? analytics.highestScore.toFixed(1) : '—', color: '#10B981' },
                    { label: 'Median',  value: analytics.medianScore  != null ? analytics.medianScore.toFixed(1)  : '—', color: '#111827' },
                    { label: 'Average', value: avgScore != null ? `${avgScore}` : '—',                                    color: '#3B82F6' },
                    { label: 'Lowest',  value: analytics.lowestScore  != null ? analytics.lowestScore.toFixed(1)  : '—', color: '#EF4444' },
                    { label: 'Flagged', value: analytics.flaggedAttempts != null ? String(analytics.flaggedAttempts) : '—', color: '#F97316' },
                  ].map(stat => (
                    <div key={stat.label}>
                      <p style={{ fontSize: '12px', color: '#6B7280', margin: '0 0 6px' }}>{stat.label}</p>
                      <p style={{ fontSize: '22px', fontWeight: 700, color: stat.color, margin: 0 }}>{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Score distribution */}
            <div className="rounded-2xl p-6" style={{ backgroundColor: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
              <h3 className="text-base font-semibold mb-4" style={{ color: '#111827' }}>Score Distribution</h3>
              <ScoreBarChart buckets={buckets} passingPct={passingPct} passRate={passRatePct} />
            </div>
          </div>

          {/* Right sidebar */}
          <div className="space-y-4">
            {/* Composition */}
            <div className="rounded-2xl p-5" style={{ backgroundColor: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
              <h3 className="text-sm font-semibold mb-4" style={{ color: '#111827' }}>Composition</h3>
              {[
                { label: 'MCQ',        count: mcqCount,        color: '#3B82F6' },
                { label: 'Coding',     count: codingCount,     color: '#8B5CF6' },
                { label: 'Behavioral', count: behavioralCount, color: '#F59E0B' },
              ].map(item => (
                <div key={item.label} className="mb-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium" style={{ color: item.color }}>{item.label}</span>
                    <span className="text-sm font-semibold" style={{ color: '#111827' }}>{item.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#F3F4F6' }}>
                    <div className="h-full rounded-full" style={{ width: `${(item.count / compMax) * 100}%`, backgroundColor: item.color }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Quick actions */}
            <div className="rounded-2xl p-5" style={{ backgroundColor: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: '#111827' }}>Quick actions</h3>
              <div className="space-y-1">
                {[
                  { label: 'Edit questions',    icon: <FileQuestion size={14} />, action: () => switchTab('questions') },
                  { label: 'Manage candidates', icon: <Users size={14} />, action: () => switchTab('candidates') },
                  { label: 'Proctoring rules',  icon: <ShieldCheck size={14} />, action: () => switchTab('ai-proctoring') },
                  { label: 'Full analytics',    icon: <LayoutDashboard size={14} />, action: () => navigate(`/admin/tests/${testId}/analytics`) },
                ].map(item => (
                  <button key={item.label} onClick={item.action}
                    className="w-full flex items-center justify-between px-3 py-3 rounded-xl text-sm font-medium"
                    style={{ color: '#374151', transition: 'background-color 0.15s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#EDF0F7'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}>
                    <span className="flex items-center gap-2.5">{item.icon}{item.label}</span>
                    <ChevronRight size={14} color="#9CA3AF" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ QUESTIONS TAB ═══════════════ */}
      {activeTab === 'questions' && (
        <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid #F3F4F6' }}>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2" size={14} style={{ color: '#9CA3AF' }} />
              <input
                value={qSearch}
                onChange={e => { setQSearch(e.target.value); setQPage(1); }}
                placeholder="Search questions..."
                className="pl-9 pr-4 py-2 rounded-xl border text-sm outline-none"
                style={{ borderColor: '#E5E7EB', color: '#111827', width: '220px', backgroundColor: 'white' }}
              />
            </div>
            {/* Type filter */}
            <select value={qTypeFilter} onChange={e => { setQTypeFilter(e.target.value); setQPage(1); }}
              className="px-3 py-2 rounded-xl border text-sm outline-none cursor-pointer"
              style={{ borderColor: '#E5E7EB', color: '#374151', backgroundColor: 'white' }}>
              <option value="all">All types</option>
              <option value="mcq">MCQ</option>
              <option value="coding">Coding</option>
              <option value="behavioral">Behavioral</option>
            </select>
            {/* Difficulty filter */}
            <select value={qDiffFilter} onChange={e => { setQDiffFilter(e.target.value); setQPage(1); }}
              className="px-3 py-2 rounded-xl border text-sm outline-none cursor-pointer"
              style={{ borderColor: '#E5E7EB', color: '#374151', backgroundColor: 'white' }}>
              <option value="all">All difficulty</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
            <div className="flex-1" />
            {/* Section manager */}
            <button onClick={() => setShowSectionModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium"
              style={{ borderColor: '#E5E7EB', color: '#374151', backgroundColor: 'white' }}>
              <Plus size={13} />
              Section
            </button>
            {/* Add from Library */}
            <button onClick={() => navigate('/admin/repository/question-bank', { state: { fromTestId: testId, fromTestName: test?.name } })}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl border text-sm font-medium"
              style={{ borderColor: '#E5E7EB', color: '#374151', backgroundColor: 'white' }}>
              <LibraryBig size={14} />
              Add from Library
            </button>
            {/* New question dropdown */}
            <div className="relative">
              {showNewQMenu && <div className="fixed inset-0 z-10" onClick={() => setShowNewQMenu(false)} />}
              <button onClick={() => setShowNewQMenu(v => !v)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ backgroundColor: '#10B981' }}>
                <Plus size={13} color="white" />
                New question
                <ChevronDown size={12} color="white" />
              </button>
              {showNewQMenu && (
                <div className="absolute right-0 top-full mt-1 w-40 rounded-xl border py-1 z-20"
                  style={{ backgroundColor: 'white', borderColor: '#E5E7EB', boxShadow: '0 4px 16px rgba(0,0,0,0.10)' }}>
                  {[
                    { label: 'MCQ', action: () => navigate('/admin/mcq/new') },
                    { label: 'Coding', action: () => navigate('/admin/coding/new') },
                    { label: 'Behavioral', action: () => handleOpenCustomModal(null, 'behavioral') },
                  ].map(item => (
                    <button key={item.label} onClick={() => { setShowNewQMenu(false); item.action(); }}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors"
                      style={{ color: '#374151' }}>
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Type coverage warning */}
          {typeCoverageWarning && (
            <div className="mx-5 mt-4 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: '#FDE68A', backgroundColor: '#FFFBEB', color: '#92400E' }}>
              {typeCoverageWarning}
            </div>
          )}

          {/* Selection banner */}
          {selectedQIds.size > 0 && (
            <div className="mx-5 mt-4 flex items-center gap-3 rounded-xl px-4 py-3"
              style={{ backgroundColor: '#F0FDF4', border: '1px solid #A7F3D0' }}>
              <span className="text-sm font-semibold" style={{ color: '#059669' }}>{selectedQIds.size} selected</span>
              <button onClick={handleDuplicateSelected}
                className="px-3 py-1.5 rounded-lg border text-sm font-medium"
                style={{ borderColor: '#E5E7EB', color: '#374151', backgroundColor: 'white' }}>
                Duplicate
              </button>
              <button onClick={handleRemoveSelected}
                className="px-3 py-1.5 rounded-lg text-sm font-medium"
                style={{ color: '#DC2626', backgroundColor: '#FEF2F2' }}>
                Remove
              </button>
              <button onClick={() => setSelectedQIds(new Set())} className="ml-auto text-sm" style={{ color: '#9CA3AF' }}>
                Clear
              </button>
            </div>
          )}

          {/* Empty state or table */}
          {allFlatQuestions.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <div className="h-12 w-12 rounded-xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#F3F4F6' }}>
                <FileQuestion size={22} color="#9CA3AF" />
              </div>
              <p className="text-sm font-medium" style={{ color: '#374151' }}>No questions yet</p>
              <p className="text-sm mt-1" style={{ color: '#9CA3AF' }}>Use "+ New question" or "Add from Library" to get started.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <th className="px-5 py-3 w-10">
                        <input type="checkbox"
                          checked={pagedQs.length > 0 && pagedQs.every(q => selectedQIds.has(q.id))}
                          onChange={e => {
                            if (e.target.checked) {
                              setSelectedQIds(new Set([...selectedQIds, ...pagedQs.map(q => q.id)]));
                            } else {
                              const next = new Set(selectedQIds);
                              pagedQs.forEach(q => next.delete(q.id));
                              setSelectedQIds(next);
                            }
                          }}
                          className="h-4 w-4 rounded" style={{ accentColor: '#10B981' }}
                        />
                      </th>
                      {['#', 'QUESTION', 'TYPE', 'DIFFICULTY', 'POINTS'].map(col => (
                        <th key={col} className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                          style={{ color: '#9CA3AF', whiteSpace: 'nowrap' }}>{col}</th>
                      ))}
                      <th className="px-3 py-3 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {pagedQs.map((q, idx) => {
                      const globalIdx = (qPage - 1) * Q_PAGE_SIZE + idx + 1;
                      const text = qTextOf(q);
                      const diff = qDiffOf(q);
                      const marks = qMarksOf(q);
                      const isSelected = selectedQIds.has(q.id);

                      const typeMap: Record<string, { label: string; bg: string; color: string; icon: JSX.Element }> = {
                        mcq: { label: 'MCQ', bg: '#DBEAFE', color: '#1D4ED8',
                          icon: <CheckSquare size={11} color="#1D4ED8" /> },
                        coding: { label: 'Coding', bg: '#EDE9FE', color: '#7C3AED',
                          icon: <Code2 size={11} color="#7C3AED" /> },
                        behavioral: { label: 'Behavioral', bg: '#FEF3C7', color: '#D97706',
                          icon: <Brain size={11} color="#D97706" /> },
                      };
                      const tc = typeMap[q.questionType] || typeMap.mcq;

                      const diffMap: Record<string, { bg: string; color: string }> = {
                        easy:   { bg: '#D1FAE5', color: '#059669' },
                        medium: { bg: '#FEF3C7', color: '#D97706' },
                        hard:   { bg: '#FEE2E2', color: '#DC2626' },
                      };
                      const dc = diffMap[diff] || diffMap.medium;

                      const subtitle = q.questionType === 'mcq'
                        ? `${q.mcqQuestion?.options?.length ?? 4} options`
                        : q.questionType === 'coding'
                        ? (() => {
                            try {
                              const raw = (q.codingQuestion as any)?.supportedLanguages;
                              if (!raw) return 'Code';
                              const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
                              return Array.isArray(arr) ? arr[0] : String(raw).split(',')[0];
                            } catch { return 'Code'; }
                          })()
                        : 'Free text';

                      const sectionName = (() => {
                        const sec = sections.find(s => (s.questions || []).some(sq => sq.id === q.id));
                        return sec ? sec.name : null;
                      })();

                      return (
                        <tr key={q.id} className="hover:bg-gray-50 transition-colors"
                          style={{ borderBottom: '1px solid #F9FAFB', backgroundColor: isSelected ? '#F0FDF4' : undefined }}>
                          <td className="px-5 py-3.5">
                            <input type="checkbox" checked={isSelected}
                              onChange={e => {
                                const next = new Set(selectedQIds);
                                if (e.target.checked) next.add(q.id); else next.delete(q.id);
                                setSelectedQIds(next);
                              }}
                              className="h-4 w-4 rounded" style={{ accentColor: '#10B981' }}
                            />
                          </td>
                          <td className="px-3 py-3.5 text-sm font-mono" style={{ color: '#9CA3AF' }}>
                            {String(globalIdx).padStart(2, '0')}
                          </td>
                          <td className="px-3 py-3.5 max-w-xs">
                            <div className="flex items-start gap-3">
                              <div className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                                style={{ backgroundColor: tc.bg }}>
                                {tc.icon}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate" style={{ color: '#111827', maxWidth: '340px' }}>
                                  {text.length > 75 ? text.slice(0, 75) + '…' : text}
                                </p>
                                <p className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>
                                  {subtitle}{sectionName ? ` · ${sectionName}` : ''}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3.5">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                              style={{ backgroundColor: tc.bg, color: tc.color }}>
                              {tc.icon}{tc.label}
                            </span>
                          </td>
                          <td className="px-3 py-3.5">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold"
                              style={{ backgroundColor: dc.bg, color: dc.color }}>
                              {diff.charAt(0).toUpperCase() + diff.slice(1)}
                            </span>
                          </td>
                          <td className="px-3 py-3.5">
                            <span className="text-sm font-semibold" style={{ color: '#374151' }}>{marks}</span>
                          </td>
                          <td className="px-3 py-3.5">
                            <button onClick={() => handleRemoveQuestion(q.id)}
                              className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                              title="Remove from test">
                              <Trash2 size={14} color="#D1D5DB" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination footer */}
              <div className="flex items-center justify-between px-5 py-4" style={{ borderTop: '1px solid #F3F4F6' }}>
                <p className="text-sm" style={{ color: '#6B7280' }}>
                  Showing {Math.min(qPage * Q_PAGE_SIZE, filteredQs.length)} of {filteredQs.length} questions
                  <span className="font-semibold ml-1" style={{ color: '#374151' }}>· {totalQPoints} points total</span>
                </p>
                {totalQPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => setQPage(p => Math.max(1, p - 1))} disabled={qPage === 1}
                      className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-40 transition-colors">
                      <ChevronLeft size={14} color="#374151" />
                    </button>
                    {Array.from({ length: totalQPages }, (_, i) => i + 1).map(p => (
                      <button key={p} onClick={() => setQPage(p)}
                        className="h-8 w-8 rounded-lg text-sm font-medium transition-colors"
                        style={{ backgroundColor: qPage === p ? '#10B981' : 'transparent', color: qPage === p ? 'white' : '#374151' }}>
                        {p}
                      </button>
                    ))}
                    <button onClick={() => setQPage(p => Math.min(totalQPages, p + 1))} disabled={qPage === totalQPages}
                      className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-40 transition-colors">
                      <ChevronRight size={14} color="#374151" />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════════════ CANDIDATES TAB ═══════════════ */}
      {activeTab === 'candidates' && <TestCandidatesPanel testId={testId!} onInvite={openInviteModal} />}

      {/* ═══════════════ AI PROCTORING TAB ═══════════════ */}
      {activeTab === 'ai-proctoring' && <TestAIProctoring />}

      {/* ═══════════════ SETTINGS TAB ═══════════════ */}
      {activeTab === 'settings' && <TestSettings />}

      {/* ══ MODALS (all preserved) ══ */}

      {/* Add Section Modal */}
      {showSectionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="rounded-2xl p-6 w-full max-w-lg" style={{ backgroundColor: 'white' }}>
            <h3 className="text-lg font-semibold mb-1" style={{ color: '#111827' }}>Add Section</h3>
            <p className="text-sm mb-4" style={{ color: '#6B7280' }}>Each section will randomly pick 1 question per candidate.</p>
            <label className="block text-sm font-medium mb-2" style={{ color: '#374151' }}>Section Name</label>
            <input type="text" value={newSectionName} onChange={e => setNewSectionName(e.target.value)} className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none mb-4" style={{ borderColor: '#E5E7EB', color: '#111827' }} placeholder="e.g. Frontend Fundamentals" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowSectionModal(false); setNewSectionName(''); }} className="rounded-xl border px-4 py-2 text-sm font-medium" style={{ borderColor: '#E5E7EB', color: '#374151' }} disabled={creatingSection}>Cancel</button>
              <button onClick={handleCreateSection} className="rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: '#10B981' }} disabled={creatingSection}>{creatingSection ? 'Creating...' : 'Create Section'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Existing Question Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="rounded-2xl p-6 w-full max-w-2xl max-h-[80vh] overflow-auto" style={{ backgroundColor: 'white' }}>
            <h3 className="text-lg font-semibold mb-4" style={{ color: '#111827' }}>
              Add Existing {questionType === 'mcq' ? 'MCQ' : questionType === 'coding' ? 'Coding' : 'Behavioral'} Question
            </h3>
            {activeSection && <p className="text-sm mb-4" style={{ color: '#6B7280' }}>Adding to section: <strong style={{ color: '#374151' }}>{activeSection.name}</strong></p>}
            <label className="block text-sm font-medium mb-2" style={{ color: '#374151' }}>Select Question</label>
            <select value={selectedQuestion} onChange={e => setSelectedQuestion(e.target.value)} className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none mb-4" style={{ borderColor: '#E5E7EB', color: '#111827' }}>
              <option value="">Select a question...</option>
              {availableQuestions.map(q => {
                const usage = sectionUsageMap.get(`${questionType}:${q.id}`);
                return (
                  <option key={q.id} value={q.id}>
                    {questionType === 'mcq' ? (q as MCQQuestion).questionText.substring(0, 100) : questionType === 'coding' ? (q as CodingQuestion).title : (q as BehavioralQuestion).title}
                    {' '}({q.marks} marks){usage?.length ? ` • Section ${usage.join(', ')}` : ''}
                  </option>
                );
              })}
            </select>
            {selectedQuestionUsage && selectedQuestionUsage.length > 0 && (
              <p className="text-sm mb-4" style={{ color: '#F59E0B' }}>This question is already in section{selectedQuestionUsage.length > 1 ? 's' : ''} {selectedQuestionUsage.join(', ')}.</p>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowAddModal(false); setSelectedQuestion(''); setActiveSectionId(null); }} className="rounded-xl border px-4 py-2 text-sm font-medium" style={{ borderColor: '#E5E7EB', color: '#374151' }}>Cancel</button>
              <button onClick={handleAddQuestion} className="rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: '#10B981' }}>Add Question</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Custom Question Modal */}
      {showCustomModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="rounded-2xl p-6 w-full max-w-3xl max-h-[90vh] overflow-auto" style={{ backgroundColor: 'white' }}>
            <h3 className="text-lg font-semibold mb-4" style={{ color: '#111827' }}>Add Custom Question</h3>
            {activeSection && <p className="text-sm mb-4" style={{ color: '#6B7280' }}>Adding to: <strong>{activeSection.name}</strong></p>}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>Question Type</label>
                <select value={customType} onChange={e => setCustomType(e.target.value as 'mcq' | 'coding' | 'behavioral')} className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none" style={{ borderColor: '#E5E7EB', color: '#111827' }}>
                  <option value="mcq">MCQ</option><option value="coding">Coding</option><option value="behavioral">Behavioral</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>Marks</label>
                <input type="number" min={1} value={customMarks} onChange={e => setCustomMarks(Number(e.target.value))} className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none" style={{ borderColor: '#E5E7EB', color: '#111827' }} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>Difficulty</label>
                <select value={customDifficulty} onChange={e => setCustomDifficulty(e.target.value as 'easy' | 'medium' | 'hard')} className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none" style={{ borderColor: '#E5E7EB', color: '#111827' }}>
                  <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>Topic (optional)</label>
                <input type="text" value={customTopic} onChange={e => setCustomTopic(e.target.value)} className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none" style={{ borderColor: '#E5E7EB', color: '#111827' }} />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>Tags (comma separated)</label>
              <input type="text" value={customTags} onChange={e => setCustomTags(e.target.value)} className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none" style={{ borderColor: '#E5E7EB', color: '#111827' }} placeholder="communication, sql" />
            </div>
            {customType === 'mcq' && (
              <div className="space-y-4 border rounded-xl p-4 mb-4" style={{ borderColor: '#F3F4F6' }}>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>Question Text</label>
                  <textarea className="w-full rounded-xl border px-4 py-3 text-sm outline-none min-h-[90px]" style={{ borderColor: '#E5E7EB', color: '#111827' }} value={customMCQ.questionText} onChange={e => setCustomMCQ(p => ({ ...p, questionText: e.target.value }))} />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-sm font-medium" style={{ color: '#374151' }}>Options</label>
                    <button onClick={addMCQOption} className="text-xs font-semibold px-3 py-1 rounded-lg border" style={{ borderColor: '#E5E7EB', color: '#374151' }}>Add Option</button>
                  </div>
                  {customMCQ.options.map((opt, idx) => (
                    <div key={idx} className="flex gap-2 items-center mb-2">
                      <span className="text-sm w-6" style={{ color: '#9CA3AF' }}>{idx + 1}.</span>
                      <input type="text" value={opt} onChange={e => setMCQOption(idx, e.target.value)} className="flex-1 rounded-xl border px-3 py-2 text-sm outline-none" style={{ borderColor: '#E5E7EB', color: '#111827' }} />
                      <button onClick={() => removeMCQOption(idx)} className="text-xs px-2 py-1 rounded-lg" style={{ color: '#DC2626', backgroundColor: '#FEF2F2' }} disabled={customMCQ.options.length <= 2}>Remove</button>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>Correct Option Numbers (e.g. 1,3)</label>
                    <input type="text" value={customMCQ.correctAnswers} onChange={e => setCustomMCQ(p => ({ ...p, correctAnswers: e.target.value }))} className="w-full rounded-xl border px-3 py-2 text-sm outline-none" style={{ borderColor: '#E5E7EB', color: '#111827' }} />
                  </div>
                  <label className="flex items-center gap-2 mt-7 text-sm" style={{ color: '#374151' }}>
                    <input type="checkbox" checked={customMCQ.isMultipleChoice} onChange={e => setCustomMCQ(p => ({ ...p, isMultipleChoice: e.target.checked }))} />
                    Multiple correct answers
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>Explanation (optional)</label>
                  <textarea className="w-full rounded-xl border px-4 py-3 text-sm outline-none min-h-[80px]" style={{ borderColor: '#E5E7EB', color: '#111827' }} value={customMCQ.explanation} onChange={e => setCustomMCQ(p => ({ ...p, explanation: e.target.value }))} />
                </div>
              </div>
            )}
            {customType === 'coding' && (
              <div className="space-y-4 border rounded-xl p-4 mb-4" style={{ borderColor: '#F3F4F6' }}>
                <input type="text" className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none" style={{ borderColor: '#E5E7EB', color: '#111827' }} placeholder="Title" value={customCoding.title} onChange={e => setCustomCoding(p => ({ ...p, title: e.target.value }))} />
                <textarea className="w-full rounded-xl border px-4 py-3 text-sm outline-none min-h-[100px]" style={{ borderColor: '#E5E7EB', color: '#111827' }} placeholder="Description" value={customCoding.description} onChange={e => setCustomCoding(p => ({ ...p, description: e.target.value }))} />
                <div className="grid grid-cols-2 gap-4">
                  <textarea className="rounded-xl border px-4 py-3 text-sm outline-none min-h-[70px]" style={{ borderColor: '#E5E7EB', color: '#111827' }} placeholder="Input Format" value={customCoding.inputFormat} onChange={e => setCustomCoding(p => ({ ...p, inputFormat: e.target.value }))} />
                  <textarea className="rounded-xl border px-4 py-3 text-sm outline-none min-h-[70px]" style={{ borderColor: '#E5E7EB', color: '#111827' }} placeholder="Output Format" value={customCoding.outputFormat} onChange={e => setCustomCoding(p => ({ ...p, outputFormat: e.target.value }))} />
                  <textarea className="rounded-xl border px-4 py-3 text-sm outline-none min-h-[70px]" style={{ borderColor: '#E5E7EB', color: '#111827' }} placeholder="Sample Input" value={customCoding.sampleInput} onChange={e => setCustomCoding(p => ({ ...p, sampleInput: e.target.value }))} />
                  <textarea className="rounded-xl border px-4 py-3 text-sm outline-none min-h-[70px]" style={{ borderColor: '#E5E7EB', color: '#111827' }} placeholder="Sample Output" value={customCoding.sampleOutput} onChange={e => setCustomCoding(p => ({ ...p, sampleOutput: e.target.value }))} />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <input type="text" className="rounded-xl border px-4 py-2.5 text-sm outline-none" style={{ borderColor: '#E5E7EB', color: '#111827' }} placeholder="Languages (csv)" value={customCoding.supportedLanguages} onChange={e => setCustomCoding(p => ({ ...p, supportedLanguages: e.target.value }))} />
                  <input type="number" className="rounded-xl border px-4 py-2.5 text-sm outline-none" style={{ borderColor: '#E5E7EB', color: '#111827' }} placeholder="Time limit (ms)" value={customCoding.timeLimit} onChange={e => setCustomCoding(p => ({ ...p, timeLimit: Number(e.target.value) }))} />
                  <input type="number" className="rounded-xl border px-4 py-2.5 text-sm outline-none" style={{ borderColor: '#E5E7EB', color: '#111827' }} placeholder="Memory (MB)" value={customCoding.memoryLimit} onChange={e => setCustomCoding(p => ({ ...p, memoryLimit: Number(e.target.value) }))} />
                </div>
                <label className="flex items-center gap-2 text-sm" style={{ color: '#374151' }}>
                  <input type="checkbox" checked={customCoding.partialScoring} onChange={e => setCustomCoding(p => ({ ...p, partialScoring: e.target.checked }))} />
                  Enable partial scoring
                </label>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-sm font-medium" style={{ color: '#374151' }}>Test Cases</h4>
                    <button onClick={addCodingTestCase} className="text-xs px-3 py-1 rounded-lg border" style={{ borderColor: '#E5E7EB', color: '#374151' }}>Add Test Case</button>
                  </div>
                  {customCodingTestCases.map((tc, idx) => (
                    <div key={idx} className="border rounded-xl p-3 mb-3" style={{ borderColor: '#F3F4F6' }}>
                      <div className="flex justify-between items-center mb-2">
                        <p className="text-xs font-semibold" style={{ color: '#374151' }}>Test Case {idx + 1}</p>
                        <button onClick={() => removeCodingTestCase(idx)} className="text-xs px-2 py-0.5 rounded-lg" style={{ color: '#DC2626', backgroundColor: '#FEF2F2' }} disabled={customCodingTestCases.length <= 1}>Remove</button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-2">
                        <textarea className="rounded-xl border px-3 py-2 text-sm outline-none min-h-[60px]" style={{ borderColor: '#E5E7EB', color: '#111827' }} placeholder="Input" value={tc.input} onChange={e => setCodingTestCaseField(idx, 'input', e.target.value)} />
                        <textarea className="rounded-xl border px-3 py-2 text-sm outline-none min-h-[60px]" style={{ borderColor: '#E5E7EB', color: '#111827' }} placeholder="Expected Output" value={tc.expectedOutput} onChange={e => setCodingTestCaseField(idx, 'expectedOutput', e.target.value)} />
                      </div>
                      <div className="flex gap-4 items-center">
                        <label className="flex items-center gap-2 text-sm" style={{ color: '#374151' }}>
                          <input type="checkbox" checked={tc.isHidden} onChange={e => setCodingTestCaseField(idx, 'isHidden', e.target.checked)} />
                          Hidden
                        </label>
                        <input type="number" min={0} className="rounded-xl border px-3 py-1.5 text-sm outline-none w-24" style={{ borderColor: '#E5E7EB', color: '#111827' }} value={tc.marks} onChange={e => setCodingTestCaseField(idx, 'marks', Number(e.target.value))} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {customType === 'behavioral' && (
              <div className="space-y-4 border rounded-xl p-4 mb-4" style={{ borderColor: '#F3F4F6' }}>
                <input type="text" className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none" style={{ borderColor: '#E5E7EB', color: '#111827' }} placeholder="Title" value={customBehavioral.title} onChange={e => setCustomBehavioral(p => ({ ...p, title: e.target.value }))} />
                <textarea className="w-full rounded-xl border px-4 py-3 text-sm outline-none min-h-[120px]" style={{ borderColor: '#E5E7EB', color: '#111827' }} placeholder="Question Description" value={customBehavioral.description} onChange={e => setCustomBehavioral(p => ({ ...p, description: e.target.value }))} />
                <textarea className="w-full rounded-xl border px-4 py-3 text-sm outline-none min-h-[90px]" style={{ borderColor: '#E5E7EB', color: '#111827' }} placeholder="Expected Answer (optional)" value={customBehavioral.expectedAnswer} onChange={e => setCustomBehavioral(p => ({ ...p, expectedAnswer: e.target.value }))} />
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowCustomModal(false); resetCustomForm(); setActiveSectionId(null); }} className="rounded-xl border px-4 py-2 text-sm font-medium" style={{ borderColor: '#E5E7EB', color: '#374151' }} disabled={savingCustom}>Cancel</button>
              <button onClick={handleAddCustomQuestion} className="rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: '#10B981' }} disabled={savingCustom}>{savingCustom ? 'Adding...' : 'Add Custom Question'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <div className="rounded-2xl w-full max-w-lg overflow-hidden" style={{ backgroundColor: 'white', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid #F3F4F6' }}>
              <div>
                <h2 className="text-base font-bold" style={{ color: '#111827' }}>Invite Candidates</h2>
                <p className="text-xs mt-0.5" style={{ color: '#6B7280' }}>
                  Upload a CSV or XLSX file with <span className="font-semibold" style={{ color: '#374151' }}>name, email</span> columns
                </p>
              </div>
              <button
                onClick={closeInviteModal}
                disabled={sendingInvitations}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                style={{ color: '#9CA3AF' }}>
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {/* File upload */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#374151' }}>Candidate File</label>
                <label
                  className="flex flex-col items-center justify-center w-full rounded-xl border-2 border-dashed cursor-pointer transition-colors hover:border-green-400"
                  style={{ borderColor: '#E5E7EB', backgroundColor: '#FAFAFA', minHeight: '90px', padding: '16px' }}>
                  <input
                    type="file"
                    accept=".csv,.xlsx"
                    className="hidden"
                    onChange={e => setInvitationFile(e.target.files?.[0] || null)}
                    disabled={sendingInvitations}
                  />
                  {invitationFile ? (
                    <div className="flex items-center gap-2">
                      <ClipboardCheck size={16} color="#10B981" />
                      <span className="text-sm font-medium" style={{ color: '#059669' }}>{invitationFile.name}</span>
                    </div>
                  ) : (
                    <>
                      <Upload size={20} color="#9CA3AF" className="mb-2" />
                      <span className="text-sm" style={{ color: '#6B7280' }}>Click to upload <span style={{ color: '#10B981', fontWeight: 600 }}>.csv</span> or <span style={{ color: '#10B981', fontWeight: 600 }}>.xlsx</span></span>
                    </>
                  )}
                </label>
              </div>

              {/* Custom message */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#374151' }}>Custom Message <span style={{ color: '#9CA3AF', fontWeight: 400 }}>(optional)</span></label>
                <textarea
                  value={customMessage}
                  onChange={e => setCustomMessage(e.target.value)}
                  rows={3}
                  placeholder="Add a personal note to the invitation email..."
                  disabled={sendingInvitations}
                  className="w-full rounded-xl border px-4 py-3 text-sm outline-none resize-none"
                  style={{ borderColor: '#E5E7EB', color: '#111827', backgroundColor: 'white', fontFamily: 'inherit' }}
                />
              </div>

              {/* Status banners */}
              {sendingInvitations && (
                <div className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1D4ED8' }}>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2" style={{ borderColor: '#1D4ED8', flexShrink: 0 }} />
                  Sending in batches of 10. Please wait...
                </div>
              )}
              {invitationSummary && (
                <div className="rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', color: '#059669' }}>
                  <span className="font-semibold">Done!</span> Total: {invitationSummary.total} · Sent: {invitationSummary.sent} · Failed: {invitationSummary.failed}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 px-6 py-4" style={{ borderTop: '1px solid #F3F4F6' }}>
              <button
                onClick={handleSendInvitations}
                disabled={sendingInvitations || !invitationFile}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
                style={{ backgroundColor: sendingInvitations || !invitationFile ? '#A7F3D0' : '#10B981', cursor: sendingInvitations || !invitationFile ? 'not-allowed' : 'pointer' }}>
                {sendingInvitations ? 'Sending...' : 'Send Invitations'}
              </button>
              <button
                onClick={closeInviteModal}
                disabled={sendingInvitations}
                className="px-5 py-2.5 rounded-xl border text-sm font-medium transition-colors hover:bg-gray-50"
                style={{ borderColor: '#E5E7EB', color: '#374151', backgroundColor: 'white' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
