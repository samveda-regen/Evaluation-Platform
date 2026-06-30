import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { Test, MCQQuestion, CodingQuestion } from '../../types';
import TestCandidatesPanel from './TestCandidatesPanel';
import TestAIProctoring from './TestAIProctoring';
import TestSettings from './TestSettings';
import BackButton from '../../components/BackButton';
import CustomSelect from '../../components/CustomSelect';
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

/* -- Build display buckets — always show all 5 bands, defaulting to 0 -- */
function buildBuckets(dist: Record<string, number> | null, _totalMarks: number) {
  const source = dist ?? {};
  return SCORE_BANDS.map(label => ({ label, count: source[label] ?? 0 }));
}

/* -- Bar colour based on which percentage band it falls in vs passing score -- */
function bandColor(label: string, passingPct: number): string {
  const upper = parseInt(label.split('-')[1] ?? '100', 10);
  const lower = parseInt(label.split('-')[0] ?? '0', 10);
  if (upper <= passingPct - 15) return '#F87171'; // clearly failing ? red
  if (lower < passingPct)       return '#FCD34D'; // borderline ? amber
  return 'var(--admin-accent)';                                // passing ? green
}

/* -- Score distribution bar chart -- */
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
          const color = b.count > 0 ? bandColor(b.label, passingPct) : 'var(--admin-border)';
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
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--admin-text-muted)' }}>{b.label}</span>
              <span style={{ fontSize: '11px', color: 'var(--admin-text-muted)' }}>{b.count}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--admin-border)' }}>
        <span style={{ fontSize: '13px', color: 'var(--admin-text-muted)' }}>
          Passing score&nbsp;<strong style={{ color: 'var(--admin-text)' }}>{passingPct}%</strong>
        </span>
        <span style={{ fontSize: '13px', color: 'var(--admin-text-muted)' }}>
          Pass rate&nbsp;<strong style={{ color: 'var(--admin-accent)' }}>{passRate != null ? Math.round(passRate) : 0}%</strong>
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

  /* -- Questions tab UI state -- */
  const [qSearch, setQSearch] = useState('');
  const [qTypeFilter, setQTypeFilter] = useState('all');
  const [qDiffFilter, setQDiffFilter] = useState('all');
  const [qTagFilter, setQTagFilter] = useState('all');
  const [qPage, setQPage] = useState(1);
  const [selectedQIds, setSelectedQIds] = useState<Set<string>>(new Set());
  const [showNewQMenu, setShowNewQMenu] = useState(false);
  const [newQMenuIndex, setNewQMenuIndex] = useState(0);
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

  /* -- Questions-tab computed values -- */
  const allFlatQuestions = [...unsectionedQuestions, ...sections.flatMap(s => s.questions || [])];
  const qTextOf = (q: TestQuestion): string =>
    (q.questionType === 'mcq' ? q.mcqQuestion?.questionText
      : q.questionType === 'coding' ? q.codingQuestion?.title
      : q.behavioralQuestion?.title) || '';
  const qDiffOf = (q: TestQuestion): string =>
    (((q.mcqQuestion as any)?.difficulty || (q.codingQuestion as any)?.difficulty || (q.behavioralQuestion as any)?.difficulty) || 'medium').toLowerCase();
  const qTagsOf = (q: TestQuestion): string[] =>
    (((q.mcqQuestion as any)?.tags || (q.codingQuestion as any)?.tags || (q.behavioralQuestion as any)?.tags || []) as string[])
      .filter(Boolean);
  const qMarksOf = (q: TestQuestion): number =>
    q.mcqQuestion?.marks || q.codingQuestion?.marks || q.behavioralQuestion?.marks || 0;
  const qTagOptions = Array.from(new Set(allFlatQuestions.flatMap(qTagsOf))).sort((a, b) => a.localeCompare(b));
  const filteredQs = allFlatQuestions.filter(q => {
    const matchSearch = !qSearch || qTextOf(q).toLowerCase().includes(qSearch.toLowerCase());
    const matchType = qTypeFilter === 'all' || q.questionType === qTypeFilter;
    const matchDiff = qDiffFilter === 'all' || qDiffOf(q) === qDiffFilter;
    const matchTag = qTagFilter === 'all' || qTagsOf(q).includes(qTagFilter);
    return matchSearch && matchType && matchDiff && matchTag;
  });
  const totalQPages = Math.ceil(filteredQs.length / Q_PAGE_SIZE);
  const pagedQs = filteredQs.slice((qPage - 1) * Q_PAGE_SIZE, qPage * Q_PAGE_SIZE);
  const totalQPoints = filteredQs.reduce((s, q) => s + qMarksOf(q), 0);

  if (loading) {
    return (
      <div style={{ backgroundColor: '#F9FAFB', minHeight: '100%' }} className="flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: 'var(--admin-accent)' }} />
      </div>
    );
  }
  if (!test) return <div className="text-center py-12" style={{ color: 'var(--admin-text-muted)' }}>Test not found</div>;

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
    Published: { bg: 'var(--admin-accent-soft)', color: 'var(--admin-accent-hover)', dot: 'var(--admin-accent)' },
    Draft:     { bg: 'var(--admin-border)', color: 'var(--admin-text-muted)', dot: 'var(--admin-text-subtle)' },
    Scheduled: { bg: 'var(--admin-accent-soft)', color: 'var(--admin-accent-hover)', dot: 'var(--admin-accent)' },
    Archived:  { bg: '#FFF7ED', color: '#C2410C', dot: '#F97316' },
  };
  const sc = statusColors[status];

  const TABS: { id: ActiveTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview',      label: 'Overview',      icon: <LayoutDashboard size={15} /> },
    { id: 'questions',     label: 'Questions',     icon: <FileQuestion    size={15} /> },
    { id: 'candidates',    label: 'Candidates',    icon: <Users           size={15} /> },
    { id: 'ai-proctoring', label: 'AI Proctoring', icon: <ShieldCheck     size={15} /> },
    { id: 'settings',      label: 'Settings',      icon: <Settings2       size={15} /> },
  ];
  const newQuestionItems = [
    { label: 'MCQ', action: () => navigate('/admin/mcq/new') },
    { label: 'Coding', action: () => navigate('/admin/coding/new') },
    { label: 'Behavioral', action: () => handleOpenCustomModal(null, 'behavioral') },
  ];
  const activateNewQuestionItem = (index: number) => {
    const item = newQuestionItems[index];
    if (!item) return;
    setShowNewQMenu(false);
    item.action();
  };
  const handleNewQuestionMenuKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!showNewQMenu) {
        setShowNewQMenu(true);
        setNewQMenuIndex(0);
        return;
      }
      const direction = e.key === 'ArrowDown' ? 1 : -1;
      setNewQMenuIndex(i => (i + direction + newQuestionItems.length) % newQuestionItems.length);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (showNewQMenu) activateNewQuestionItem(newQMenuIndex);
      else setShowNewQMenu(true);
      return;
    }
    if (e.key === 'Escape' && showNewQMenu) {
      e.preventDefault();
      setShowNewQMenu(false);
    }
  };

  return (
    <div style={{ backgroundColor: '#F9FAFB', minHeight: '100%' }}>

      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          {/* Left: icon + name + meta */}
          <div className="flex items-start gap-4">
            <BackButton mt="0" />
            <div className="h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, var(--admin-accent) 0%, var(--admin-accent-hover) 100%)', boxShadow: '0 3px 10px rgba(31, 53, 86, 0.22)' }}>
              <Layers size={22} color="white" strokeWidth={1.8} />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold" style={{ color: 'var(--admin-text)' }}>{test.name}</h1>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
                  style={{ backgroundColor: sc.bg, color: sc.color }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: sc.dot }} />
                  {status}
                </span>
              </div>
              <div className="flex items-center gap-4 mt-1.5 text-sm flex-wrap" style={{ color: 'var(--admin-text-muted)' }}>
                <span className="font-mono font-semibold" style={{ color: 'var(--admin-text-muted)' }}>{test.testCode}</span>
                <span className="flex items-center gap-1">
                  <Timer size={12} color="var(--admin-accent)" />
                  {test.duration} min
                </span>
                <span className="flex items-center gap-1">
                  <FileQuestion size={12} color="var(--admin-accent)" />
                  {test._count?.questions ?? questions.length} questions
                </span>
                <span className="flex items-center gap-1">
                  <Users size={12} color="var(--admin-accent)" />
                  {totalAttempts} attempts
                </span>
              </div>
            </div>
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              className="btn btn-secondary"
              onClick={() => window.open(`/admin/tests/${testId}/preview`, '_blank')}
            >
              <Eye size={14} />
              Preview
            </button>
            <button
              onClick={openInviteModal}
              className="btn btn-secondary"
            >
              <Link2 size={14} />
              Invite link
              {totalAttempts > 0 && (
                <span className="text-xs font-bold" style={{ color: 'var(--admin-text-subtle)' }}>
                  {Math.min(totalAttempts, 9)}
                </span>
              )}
            </button>
            <button
              onClick={handlePublish}
              className="btn btn-primary"
            >
              <Upload size={14} color="white" />
              {test.isActive ? 'Publish changes' : 'Publish'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div
          className="flex items-center gap-6 mt-5 overflow-x-auto"
          style={{ borderBottom: '1px solid var(--admin-border-soft)' }}
        >
          {TABS.map(tab => {
            const active = activeTab === tab.id;
            return (
              <button
                type="button"
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                className="flex items-center gap-2 py-3 text-sm font-semibold transition-colors"
                style={{
                  color: active ? 'var(--admin-accent-hover)' : 'var(--admin-text-muted)',
                  border: 0,
                  borderBottom: active ? '2px solid var(--admin-accent)' : '2px solid transparent',
                  background: 'transparent',
                  marginBottom: '-1px',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.icon}{tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* --------------- OVERVIEW TAB --------------- */}
      {activeTab === 'overview' && (
        <div className="grid lg:grid-cols-[1fr_280px] gap-5">
          {/* Left */}
          <div className="space-y-5">
            {/* 4 stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Attempts',   value: totalAttempts.toString(),                        icon: <Users         size={26} color="var(--admin-accent)" /> },
                { label: 'Completion', value: completionPct > 0 ? `${completionPct}%` : '-',  icon: <CheckCircle2  size={26} color="var(--admin-accent)" /> },
                { label: 'Avg score',  value: avgScore != null ? `${avgScore}%` : '-',         icon: <ClipboardCheck size={26} color="var(--admin-accent)" /> },
                { label: 'Avg trust',  value: avgTrust != null ? `${avgTrust}%` : '-',         icon: <ShieldCheck   size={26} color="var(--admin-accent)" /> },
              ].map(card => (
                <div key={card.label} className="p-5" style={{ backgroundColor: 'white', borderRadius: 'var(--admin-card-radius)', boxShadow: 'var(--admin-card-shadow)' }}>
                  <div className="mb-3">{card.icon}</div>
                  <p className="text-3xl font-bold" style={{ color: 'var(--admin-text)' }}>{card.value}</p>
                  <p className="text-sm mt-1" style={{ color: 'var(--admin-text-muted)' }}>{card.label}</p>
                </div>
              ))}
            </div>

            {/* Score Statistics */}
            {analytics && analytics.completedAttempts > 0 && (analytics.highestScore != null || analytics.medianScore != null || analytics.lowestScore != null) && (
              <div className="p-6" style={{ backgroundColor: 'white', borderRadius: 'var(--admin-card-radius)', boxShadow: 'var(--admin-card-shadow)' }}>
                <h3 className="text-base font-semibold mb-5" style={{ color: 'var(--admin-text)' }}>Score Statistics</h3>
                <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
                  {[
                    { label: 'Highest', value: analytics.highestScore != null ? analytics.highestScore.toFixed(1) : '—', color: 'var(--admin-accent)' },
                    { label: 'Median',  value: analytics.medianScore  != null ? analytics.medianScore.toFixed(1)  : '—', color: 'var(--admin-text)' },
                    { label: 'Average', value: avgScore != null ? `${avgScore}` : '—',                                    color: 'var(--admin-accent)' },
                    { label: 'Lowest',  value: analytics.lowestScore  != null ? analytics.lowestScore.toFixed(1)  : '—', color: '#EF4444' },
                    { label: 'Flagged', value: analytics.flaggedAttempts != null ? String(analytics.flaggedAttempts) : '—', color: '#F97316' },
                  ].map(stat => (
                    <div key={stat.label}>
                      <p style={{ fontSize: '12px', color: 'var(--admin-text-muted)', margin: '0 0 6px' }}>{stat.label}</p>
                      <p style={{ fontSize: '22px', fontWeight: 700, color: stat.color, margin: 0 }}>{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Score distribution */}
            <div className="p-6" style={{ backgroundColor: 'white', borderRadius: 'var(--admin-card-radius)', boxShadow: 'var(--admin-card-shadow)' }}>
              <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--admin-text)' }}>Score Distribution</h3>
              <ScoreBarChart buckets={buckets} passingPct={passingPct} passRate={passRatePct} />
            </div>
          </div>

          {/* Right sidebar */}
          <div className="space-y-4">
            {/* Composition */}
            <div className="p-5" style={{ backgroundColor: 'white', borderRadius: 'var(--admin-card-radius)', boxShadow: 'var(--admin-card-shadow)' }}>
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--admin-text)' }}>Composition</h3>
              {[
                { label: 'MCQ',        count: mcqCount,        color: 'var(--admin-accent)' },
                { label: 'Coding',     count: codingCount,     color: 'var(--admin-accent-hover)' },
                { label: 'Behavioral', count: behavioralCount, color: 'var(--admin-accent-hover)' },
              ].map(item => (
                <div key={item.label} className="mb-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium" style={{ color: item.color }}>{item.label}</span>
                    <span className="text-sm font-semibold" style={{ color: 'var(--admin-text)' }}>{item.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--admin-border)' }}>
                    <div className="h-full rounded-full" style={{ width: `${(item.count / compMax) * 100}%`, backgroundColor: item.color }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Quick actions */}
            <div className="p-5" style={{ backgroundColor: 'white', borderRadius: 'var(--admin-card-radius)', boxShadow: 'var(--admin-card-shadow)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--admin-text)' }}>Quick actions</h3>
              <div className="space-y-1">
                {[
                  { label: 'Edit questions',    icon: <FileQuestion    size={14} color="var(--admin-accent)" />, action: () => switchTab('questions') },
                  { label: 'Manage candidates', icon: <Users           size={14} color="var(--admin-accent)" />, action: () => switchTab('candidates') },
                  { label: 'Proctoring rules',  icon: <ShieldCheck     size={14} color="var(--admin-accent)" />, action: () => switchTab('ai-proctoring') },
                  { label: 'Full analytics',    icon: <LayoutDashboard size={14} color="var(--admin-accent)" />, action: () => navigate(`/admin/tests/${testId}/analytics`) },
                ].map(item => (
                  <button key={item.label} onClick={item.action}
                    className="w-full flex items-center justify-between px-3 py-3 rounded-xl text-sm font-medium"
                    style={{ color: 'var(--admin-text-muted)', transition: 'background-color 0.15s, color 0.15s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(31, 53, 86, 0.08)'; (e.currentTarget as HTMLElement).style.color = 'var(--admin-accent-hover)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--admin-text-muted)'; }}>
                    <span className="flex items-center gap-2.5">{item.icon}{item.label}</span>
                    <ChevronRight size={14} color="var(--admin-text-subtle)" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --------------- QUESTIONS TAB --------------- */}
      {activeTab === 'questions' && (
        <div className="overflow-hidden" style={{ backgroundColor: 'white', borderRadius: 'var(--admin-card-radius)', boxShadow: 'var(--admin-card-shadow)' }}>

          {/* Toolbar */}
          <div
            className="flex items-center gap-3 px-5 py-4"
            style={{ borderBottom: '1px solid var(--admin-border)', overflow: 'visible' }}
          >
            {/* Search */}
            <div className="relative" style={{ flex: '1 1 auto', minWidth: 0 }}>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2" size={16} style={{ color: 'var(--admin-text-subtle)' }} />
              <input
                value={qSearch}
                onChange={e => { setQSearch(e.target.value); setQPage(1); }}
                placeholder="Search questions..."
                className="admin-filter-input pl-9 pr-4 py-2 rounded-xl border text-sm outline-none"
                style={{ width: '100%', minWidth: 0 }}
              />
            </div>
            {/* Type filter */}
            <CustomSelect
              value={qTypeFilter}
              onChange={value => { setQTypeFilter(value); setQPage(1); }}
              options={[
                { value: 'all', label: 'All types' },
                { value: 'mcq', label: 'MCQ' },
                { value: 'coding', label: 'Coding' },
                { value: 'behavioral', label: 'Behavioral' },
              ]}
              style={{ width: '150px', minWidth: '150px' }}
            />
            {/* Difficulty filter */}
            <CustomSelect
              value={qDiffFilter}
              onChange={value => { setQDiffFilter(value); setQPage(1); }}
              options={[
                { value: 'all', label: 'All difficulty' },
                { value: 'easy', label: 'Easy' },
                { value: 'medium', label: 'Medium' },
                { value: 'hard', label: 'Hard' },
              ]}
              style={{ width: '160px', minWidth: '160px' }}
            />
            {/* Tag filter */}
            <CustomSelect
              value={qTagFilter}
              onChange={value => { setQTagFilter(value); setQPage(1); }}
              options={[{ value: 'all', label: 'All tags' }, ...qTagOptions.map(tag => ({ value: tag, label: tag }))]}
              style={{ width: '150px', minWidth: '150px' }}
            />
            <div className="flex-1" />
            {/* Section manager */}
            <button onClick={() => setShowSectionModal(true)}
              className="btn btn-secondary">
              <Plus size={13} />
              Section
            </button>
            {/* Add from Library */}
            <button onClick={() => navigate('/admin/repository/question-bank', { state: { fromTestId: testId, fromTestName: test?.name } })}
              className="btn btn-secondary">
              <LibraryBig size={14} />
              Add from Library
            </button>
            {/* New question dropdown */}
            <div className="relative">
              {showNewQMenu && <div className="fixed inset-0 z-10" onClick={() => setShowNewQMenu(false)} />}
              <button onClick={() => { setShowNewQMenu(v => !v); setNewQMenuIndex(0); }}
                onKeyDown={handleNewQuestionMenuKeyDown}
                className="btn btn-primary">
                <Plus size={13} color="white" />
                New question
                <ChevronDown size={12} color="white" />
              </button>
              {showNewQMenu && (
                <div className="absolute right-0 top-full mt-1 w-40 rounded-xl border py-1 z-20"
                  style={{ backgroundColor: 'white', borderColor: 'var(--admin-border)', boxShadow: '0 4px 16px rgba(0,0,0,0.10)' }}>
                  {newQuestionItems.map((item, index) => (
                    <button key={item.label} onClick={() => activateNewQuestionItem(index)}
                      onMouseEnter={() => setNewQMenuIndex(index)}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors"
                      style={{
                        color: index === newQMenuIndex ? 'var(--admin-accent-hover)' : 'var(--admin-text-muted)',
                        backgroundColor: index === newQMenuIndex ? 'var(--admin-accent-soft)' : 'white',
                        fontWeight: index === newQMenuIndex ? 600 : 400,
                      }}>
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Type coverage warning */}
          {typeCoverageWarning && (
            <div className="mx-5 mt-4 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--admin-accent-disabled)', backgroundColor: 'var(--admin-accent-soft)', color: '#92400E' }}>
              {typeCoverageWarning}
            </div>
          )}

          {/* Selection banner */}
          {selectedQIds.size > 0 && (
            <div className="mx-5 mt-4 flex items-center gap-3 rounded-xl px-4 py-3"
              style={{ backgroundColor: 'var(--admin-accent-soft)', border: '1px solid var(--admin-accent-disabled)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--admin-accent-hover)' }}>{selectedQIds.size} selected</span>
              <button onClick={handleDuplicateSelected}
                className="px-3 py-1.5 rounded-lg border text-sm font-medium"
                style={{ borderColor: 'var(--admin-border)', color: 'var(--admin-text-muted)', backgroundColor: 'white' }}>
                Duplicate
              </button>
              <button onClick={handleRemoveSelected}
                className="px-3 py-1.5 rounded-lg text-sm font-medium"
                style={{ color: '#DC2626', backgroundColor: '#FEF2F2' }}>
                Remove
              </button>
              <button onClick={() => setSelectedQIds(new Set())} className="ml-auto text-sm" style={{ color: 'var(--admin-text-subtle)' }}>
                Clear
              </button>
            </div>
          )}

          {/* Empty state or table */}
          {allFlatQuestions.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <div className="h-12 w-12 rounded-xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: 'var(--admin-border)' }}>
                <FileQuestion size={22} color="var(--admin-text-subtle)" />
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--admin-text-muted)' }}>No questions yet</p>
              <p className="text-sm mt-1" style={{ color: 'var(--admin-text-subtle)' }}>Use "+ New question" or "Add from Library" to get started.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--admin-border)' }}>
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
                          className="h-4 w-4 rounded" style={{ accentColor: 'var(--admin-button-primary)' }}
                        />
                      </th>
                      {['#', 'QUESTION', 'TYPE', 'DIFFICULTY', 'POINTS'].map(col => (
                        <th key={col} className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                          style={{ color: 'var(--admin-text-subtle)', whiteSpace: 'nowrap' }}>{col}</th>
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
                        mcq: { label: 'MCQ', bg: 'var(--admin-accent-soft)', color: 'var(--admin-accent-hover)',
                          icon: <CheckSquare size={11} color="var(--admin-accent-hover)" /> },
                        coding: { label: 'Coding', bg: 'var(--admin-accent-soft)', color: '#C2410C',
                          icon: <Code2 size={11} color="#C2410C" /> },
                        behavioral: { label: 'Behavioral', bg: 'var(--admin-accent-disabled)', color: 'var(--admin-accent-hover)',
                          icon: <Brain size={11} color="var(--admin-accent-hover)" /> },
                      };
                      const tc = typeMap[q.questionType] || typeMap.mcq;

                      const diffMap: Record<string, { bg: string; color: string }> = {
                        easy:   { bg: 'var(--admin-accent-disabled)', color: 'var(--admin-accent-hover)' },
                        medium: { bg: 'var(--admin-accent-disabled)', color: 'var(--admin-accent-hover)' },
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
                          style={{ borderBottom: '1px solid #F9FAFB', backgroundColor: isSelected ? 'var(--admin-accent-soft)' : undefined }}>
                          <td className="px-5 py-3.5">
                            <input type="checkbox" checked={isSelected}
                              onChange={e => {
                                const next = new Set(selectedQIds);
                                if (e.target.checked) next.add(q.id); else next.delete(q.id);
                                setSelectedQIds(next);
                              }}
                              className="h-4 w-4 rounded" style={{ accentColor: 'var(--admin-button-primary)' }}
                            />
                          </td>
                          <td className="px-3 py-3.5 text-sm font-mono" style={{ color: 'var(--admin-text-subtle)' }}>
                            {String(globalIdx).padStart(2, '0')}
                          </td>
                          <td className="px-3 py-3.5 max-w-xs">
                            <div className="flex items-start gap-3">
                              <div className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                                style={{ backgroundColor: tc.bg }}>
                                {tc.icon}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate" style={{ color: 'var(--admin-text)', maxWidth: '340px' }}>
                                  {text.length > 75 ? text.slice(0, 75) + '…' : text}
                                </p>
                                <p className="text-xs mt-0.5" style={{ color: 'var(--admin-text-subtle)' }}>
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
                            <span className="text-sm font-semibold" style={{ color: 'var(--admin-text-muted)' }}>{marks}</span>
                          </td>
                          <td className="px-3 py-3.5">
                            <button onClick={() => handleRemoveQuestion(q.id)}
                              className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                              title="Remove from test">
                              <Trash2 size={14} color="#EF4444" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination footer */}
              <div className="flex items-center justify-between px-5 py-4" style={{ borderTop: '1px solid var(--admin-border)' }}>
                <p className="text-sm" style={{ color: 'var(--admin-text-muted)' }}>
                  Showing {Math.min(qPage * Q_PAGE_SIZE, filteredQs.length)} of {filteredQs.length} questions
                  <span className="font-semibold ml-1" style={{ color: 'var(--admin-text-muted)' }}>· {totalQPoints} points total</span>
                </p>
                {totalQPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => setQPage(p => Math.max(1, p - 1))} disabled={qPage === 1}
                      className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-40 transition-colors">
                      <ChevronLeft size={14} color="var(--admin-text-muted)" />
                    </button>
                    {Array.from({ length: totalQPages }, (_, i) => i + 1).map(p => (
                      <button key={p} onClick={() => setQPage(p)}
                        className="h-8 w-8 rounded-lg text-sm font-medium transition-colors"
                        style={{ backgroundColor: qPage === p ? 'var(--admin-accent)' : 'transparent', color: qPage === p ? 'white' : 'var(--admin-text-muted)' }}>
                        {p}
                      </button>
                    ))}
                    <button onClick={() => setQPage(p => Math.min(totalQPages, p + 1))} disabled={qPage === totalQPages}
                      className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-40 transition-colors">
                      <ChevronRight size={14} color="var(--admin-text-muted)" />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* --------------- CANDIDATES TAB --------------- */}
      {activeTab === 'candidates' && <TestCandidatesPanel testId={testId!} onInvite={openInviteModal} />}

      {/* --------------- AI PROCTORING TAB --------------- */}
      {activeTab === 'ai-proctoring' && <TestAIProctoring />}

      {/* --------------- SETTINGS TAB --------------- */}
      {activeTab === 'settings' && <TestSettings />}

      {/* -- MODALS (all preserved) -- */}

      {/* Add Section Modal */}
      {showSectionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="rounded-2xl p-6 w-full max-w-lg" style={{ backgroundColor: 'white' }}>
            <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--admin-text)' }}>Add Section</h3>
            <p className="text-sm mb-4" style={{ color: 'var(--admin-text-muted)' }}>Each section will randomly pick 1 question per candidate.</p>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--admin-text-muted)' }}>Section Name</label>
            <input type="text" value={newSectionName} onChange={e => setNewSectionName(e.target.value)} className="input mb-4" placeholder="e.g. Frontend Fundamentals" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowSectionModal(false); setNewSectionName(''); }} className="btn btn-secondary" disabled={creatingSection}>Cancel</button>
              <button onClick={handleCreateSection} className="btn btn-primary" disabled={creatingSection}>{creatingSection ? 'Creating...' : 'Create Section'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Existing Question Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="rounded-2xl p-6 w-full max-w-2xl max-h-[80vh] overflow-auto" style={{ backgroundColor: 'white' }}>
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--admin-text)' }}>
              Add Existing {questionType === 'mcq' ? 'MCQ' : questionType === 'coding' ? 'Coding' : 'Behavioral'} Question
            </h3>
            {activeSection && <p className="text-sm mb-4" style={{ color: 'var(--admin-text-muted)' }}>Adding to section: <strong style={{ color: 'var(--admin-text-muted)' }}>{activeSection.name}</strong></p>}
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--admin-text-muted)' }}>Select Question</label>
            <select value={selectedQuestion} onChange={e => setSelectedQuestion(e.target.value)} className="input mb-4">
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
              <p className="text-sm mb-4" style={{ color: 'var(--admin-accent)' }}>This question is already in section{selectedQuestionUsage.length > 1 ? 's' : ''} {selectedQuestionUsage.join(', ')}.</p>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowAddModal(false); setSelectedQuestion(''); setActiveSectionId(null); }} className="btn btn-secondary">Cancel</button>
              <button onClick={handleAddQuestion} className="btn btn-primary">Add Question</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Custom Question Modal */}
      {showCustomModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="rounded-2xl p-6 w-full max-w-3xl max-h-[90vh] overflow-auto" style={{ backgroundColor: 'white' }}>
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--admin-text)' }}>Add Custom Question</h3>
            {activeSection && <p className="text-sm mb-4" style={{ color: 'var(--admin-text-muted)' }}>Adding to: <strong>{activeSection.name}</strong></p>}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--admin-text-muted)' }}>Question Type</label>
                <CustomSelect
                  value={customType}
                  onChange={v => setCustomType(v as 'mcq' | 'coding' | 'behavioral')}
                  options={[{ value:'mcq', label:'MCQ' }, { value:'coding', label:'Coding' }, { value:'behavioral', label:'Behavioral' }]}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--admin-text-muted)' }}>Marks</label>
                <input type="number" value={customMarks} onChange={e => setCustomMarks(Number(e.target.value))} className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--admin-text-muted)' }}>Difficulty</label>
                <CustomSelect
                  value={customDifficulty}
                  onChange={v => setCustomDifficulty(v as 'easy' | 'medium' | 'hard')}
                  options={[{ value:'easy', label:'Easy' }, { value:'medium', label:'Medium' }, { value:'hard', label:'Hard' }]}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--admin-text-muted)' }}>Topic (optional)</label>
                <input type="text" value={customTopic} onChange={e => setCustomTopic(e.target.value)} className="input" />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--admin-text-muted)' }}>Tags (comma separated)</label>
              <input type="text" value={customTags} onChange={e => setCustomTags(e.target.value)} className="input" placeholder="communication, sql" />
            </div>
            {customType === 'mcq' && (
              <div className="space-y-4 border rounded-xl p-4 mb-4" style={{ borderColor: 'var(--admin-border)' }}>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--admin-text-muted)' }}>Question Text</label>
                  <textarea className="input min-h-[90px]" value={customMCQ.questionText} onChange={e => setCustomMCQ(p => ({ ...p, questionText: e.target.value }))} />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-sm font-medium" style={{ color: 'var(--admin-text-muted)' }}>Options</label>
                    <button onClick={addMCQOption} className="text-xs font-semibold px-3 py-1 rounded-lg border" style={{ borderColor: 'var(--admin-border)', color: 'var(--admin-text-muted)' }}>Add Option</button>
                  </div>
                  {customMCQ.options.map((opt, idx) => (
                    <div key={idx} className="flex gap-2 items-center mb-2">
                      <span className="text-sm w-6" style={{ color: 'var(--admin-text-subtle)' }}>{idx + 1}.</span>
                      <input type="text" value={opt} onChange={e => setMCQOption(idx, e.target.value)} className="input flex-1" />
                      <button onClick={() => removeMCQOption(idx)} className="text-xs px-2 py-1 rounded-lg" style={{ color: '#DC2626', backgroundColor: '#FEF2F2' }} disabled={customMCQ.options.length <= 2}>Remove</button>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: 'var(--admin-text-muted)' }}>Correct Option Numbers (e.g. 1,3)</label>
                    <input type="text" value={customMCQ.correctAnswers} onChange={e => setCustomMCQ(p => ({ ...p, correctAnswers: e.target.value }))} className="input" />
                  </div>
                  <label className="flex items-center gap-2 mt-7 text-sm" style={{ color: 'var(--admin-text-muted)' }}>
                    <input type="checkbox" checked={customMCQ.isMultipleChoice} onChange={e => setCustomMCQ(p => ({ ...p, isMultipleChoice: e.target.checked }))} />
                    Multiple correct answers
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--admin-text-muted)' }}>Explanation (optional)</label>
                  <textarea className="input min-h-[80px]" value={customMCQ.explanation} onChange={e => setCustomMCQ(p => ({ ...p, explanation: e.target.value }))} />
                </div>
              </div>
            )}
            {customType === 'coding' && (
              <div className="space-y-4 border rounded-xl p-4 mb-4" style={{ borderColor: 'var(--admin-border)' }}>
                <input type="text" className="input" placeholder="Title" value={customCoding.title} onChange={e => setCustomCoding(p => ({ ...p, title: e.target.value }))} />
                <textarea className="input min-h-[100px]" placeholder="Description" value={customCoding.description} onChange={e => setCustomCoding(p => ({ ...p, description: e.target.value }))} />
                <div className="grid grid-cols-2 gap-4">
                  <textarea className="input min-h-[70px]" placeholder="Input Format" value={customCoding.inputFormat} onChange={e => setCustomCoding(p => ({ ...p, inputFormat: e.target.value }))} />
                  <textarea className="input min-h-[70px]" placeholder="Output Format" value={customCoding.outputFormat} onChange={e => setCustomCoding(p => ({ ...p, outputFormat: e.target.value }))} />
                  <textarea className="input min-h-[70px]" placeholder="Sample Input" value={customCoding.sampleInput} onChange={e => setCustomCoding(p => ({ ...p, sampleInput: e.target.value }))} />
                  <textarea className="input min-h-[70px]" placeholder="Sample Output" value={customCoding.sampleOutput} onChange={e => setCustomCoding(p => ({ ...p, sampleOutput: e.target.value }))} />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <input type="text" className="input" placeholder="Languages (csv)" value={customCoding.supportedLanguages} onChange={e => setCustomCoding(p => ({ ...p, supportedLanguages: e.target.value }))} />
                  <input type="number" className="input" placeholder="Time limit (ms)" value={customCoding.timeLimit} onChange={e => setCustomCoding(p => ({ ...p, timeLimit: Number(e.target.value) }))} />
                  <input type="number" className="input" placeholder="Memory (MB)" value={customCoding.memoryLimit} onChange={e => setCustomCoding(p => ({ ...p, memoryLimit: Number(e.target.value) }))} />
                </div>
                <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--admin-text-muted)' }}>
                  <input type="checkbox" checked={customCoding.partialScoring} onChange={e => setCustomCoding(p => ({ ...p, partialScoring: e.target.checked }))} />
                  Enable partial scoring
                </label>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-sm font-medium" style={{ color: 'var(--admin-text-muted)' }}>Test Cases</h4>
                    <button onClick={addCodingTestCase} className="text-xs px-3 py-1 rounded-lg border" style={{ borderColor: 'var(--admin-border)', color: 'var(--admin-text-muted)' }}>Add Test Case</button>
                  </div>
                  {customCodingTestCases.map((tc, idx) => (
                    <div key={idx} className="border rounded-xl p-3 mb-3" style={{ borderColor: 'var(--admin-border)' }}>
                      <div className="flex justify-between items-center mb-2">
                        <p className="text-xs font-semibold" style={{ color: 'var(--admin-text-muted)' }}>Test Case {idx + 1}</p>
                        <button onClick={() => removeCodingTestCase(idx)} className="text-xs px-2 py-0.5 rounded-lg" style={{ color: '#DC2626', backgroundColor: '#FEF2F2' }} disabled={customCodingTestCases.length <= 1}>Remove</button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-2">
                        <textarea className="input min-h-[60px]" placeholder="Input" value={tc.input} onChange={e => setCodingTestCaseField(idx, 'input', e.target.value)} />
                        <textarea className="input min-h-[60px]" placeholder="Expected Output" value={tc.expectedOutput} onChange={e => setCodingTestCaseField(idx, 'expectedOutput', e.target.value)} />
                      </div>
                      <div className="flex gap-4 items-center">
                        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--admin-text-muted)' }}>
                          <input type="checkbox" checked={tc.isHidden} onChange={e => setCodingTestCaseField(idx, 'isHidden', e.target.checked)} />
                          Hidden
                        </label>
                        <input type="number" className="input w-24" value={tc.marks} onChange={e => setCodingTestCaseField(idx, 'marks', Number(e.target.value))} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {customType === 'behavioral' && (
              <div className="space-y-4 border rounded-xl p-4 mb-4" style={{ borderColor: 'var(--admin-border)' }}>
                <input type="text" className="input" placeholder="Title" value={customBehavioral.title} onChange={e => setCustomBehavioral(p => ({ ...p, title: e.target.value }))} />
                <textarea className="input min-h-[120px]" placeholder="Question Description" value={customBehavioral.description} onChange={e => setCustomBehavioral(p => ({ ...p, description: e.target.value }))} />
                <textarea className="input min-h-[90px]" placeholder="Expected Answer (optional)" value={customBehavioral.expectedAnswer} onChange={e => setCustomBehavioral(p => ({ ...p, expectedAnswer: e.target.value }))} />
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowCustomModal(false); resetCustomForm(); setActiveSectionId(null); }} className="btn btn-secondary" disabled={savingCustom}>Cancel</button>
              <button onClick={handleAddCustomQuestion} className="btn btn-primary" disabled={savingCustom}>{savingCustom ? 'Adding...' : 'Add Custom Question'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <div className="rounded-2xl w-full max-w-lg overflow-hidden" style={{ backgroundColor: 'white', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid var(--admin-border)' }}>
              <div>
                <h2 className="text-base font-bold" style={{ color: 'var(--admin-text)' }}>Invite Candidates</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--admin-text-muted)' }}>
                  Upload a CSV or XLSX file with <span className="font-semibold" style={{ color: 'var(--admin-text-muted)' }}>name, email</span> columns
                </p>
              </div>
              <button
                onClick={closeInviteModal}
                disabled={sendingInvitations}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                style={{ color: 'var(--admin-text-subtle)' }}>
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {/* File upload */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--admin-text-muted)' }}>Candidate File</label>
                <label
                  className="flex flex-col items-center justify-center w-full rounded-xl border-2 border-dashed cursor-pointer transition-colors hover:border-amber-400"
                  style={{ borderColor: 'var(--admin-border)', backgroundColor: '#FAFAFA', minHeight: '90px', padding: '16px' }}>
                  <input
                    type="file"
                    accept=".csv,.xlsx"
                    className="hidden"
                    onChange={e => setInvitationFile(e.target.files?.[0] || null)}
                    disabled={sendingInvitations}
                  />
                  {invitationFile ? (
                    <div className="flex items-center gap-2">
                      <ClipboardCheck size={16} color="var(--admin-accent)" />
                      <span className="text-sm font-medium" style={{ color: 'var(--admin-accent-hover)' }}>{invitationFile.name}</span>
                    </div>
                  ) : (
                    <>
                      <Upload size={20} color="var(--admin-text-subtle)" className="mb-2" />
                      <span className="text-sm" style={{ color: 'var(--admin-text-muted)' }}>Click to upload <span style={{ color: 'var(--admin-accent)', fontWeight: 600 }}>.csv</span> or <span style={{ color: 'var(--admin-accent)', fontWeight: 600 }}>.xlsx</span></span>
                    </>
                  )}
                </label>
              </div>

              {/* Custom message */}
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--admin-text-muted)' }}>Custom Message <span style={{ color: 'var(--admin-text-subtle)', fontWeight: 400 }}>(optional)</span></label>
                <textarea
                  value={customMessage}
                  onChange={e => setCustomMessage(e.target.value)}
                  rows={3}
                  placeholder="Add a personal note to the invitation email..."
                  disabled={sendingInvitations}
                  className="w-full rounded-xl border px-4 py-3 text-sm outline-none resize-none"
                  style={{ borderColor: 'var(--admin-border)', color: 'var(--admin-text)', backgroundColor: 'white', fontFamily: 'inherit' }}
                />
              </div>

              {/* Status banners */}
              {sendingInvitations && (
                <div className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: 'var(--admin-accent-soft)', border: '1px solid var(--admin-accent-disabled)', color: 'var(--admin-accent-hover)' }}>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2" style={{ borderColor: 'var(--admin-accent-hover)', flexShrink: 0 }} />
                  Sending in batches of 10. Please wait...
                </div>
              )}
              {invitationSummary && (
                <div className="rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: 'var(--admin-accent-soft)', border: '1px solid var(--admin-accent-disabled)', color: 'var(--admin-accent-hover)' }}>
                  <span className="font-semibold">Done!</span> Total: {invitationSummary.total} · Sent: {invitationSummary.sent} · Failed: {invitationSummary.failed}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 px-6 py-4" style={{ borderTop: '1px solid var(--admin-border)' }}>
              <button
                onClick={handleSendInvitations}
                disabled={sendingInvitations || !invitationFile}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
                style={{ backgroundColor: sendingInvitations || !invitationFile ? 'var(--admin-accent-disabled)' : 'var(--admin-accent)', cursor: sendingInvitations || !invitationFile ? 'not-allowed' : 'pointer' }}>
                {sendingInvitations ? 'Sending...' : 'Send Invitations'}
              </button>
              <button
                onClick={closeInviteModal}
                disabled={sendingInvitations}
                className="px-5 py-2.5 rounded-xl border text-sm font-medium transition-colors hover:bg-gray-50"
                style={{ borderColor: 'var(--admin-border)', color: 'var(--admin-text-muted)', backgroundColor: 'white' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
