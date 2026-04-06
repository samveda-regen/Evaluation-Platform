import { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminApi } from '../../services/api';
import { Test, MCQQuestion, CodingQuestion } from '../../types';
import { format } from 'date-fns';
import TestCandidatesPanel from './TestCandidatesPanel';

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

export default function TestDetails() {
  const { testId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [test, setTest] = useState<Test | null>(null);
  const [questions, setQuestions] = useState<TestQuestion[]>([]);
  const [sections, setSections] = useState<TestSection[]>([]);
  const [loading, setLoading] = useState(true);

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
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);

  const [showCustomModal, setShowCustomModal] = useState(false);
  const [savingCustom, setSavingCustom] = useState(false);
  const [customType, setCustomType] = useState<'mcq' | 'coding' | 'behavioral'>('mcq');
  const [customMarks, setCustomMarks] = useState(5);
  const [customDifficulty, setCustomDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [customTopic, setCustomTopic] = useState('');
  const [customTags, setCustomTags] = useState('');

  const [customMCQ, setCustomMCQ] = useState({
    questionText: '',
    options: ['', '', '', ''],
    correctAnswers: '',
    isMultipleChoice: false,
    explanation: ''
  });

  const [customCoding, setCustomCoding] = useState({
    title: '',
    description: '',
    inputFormat: '',
    outputFormat: '',
    constraints: '',
    sampleInput: '',
    sampleOutput: '',
    supportedLanguages: 'python,javascript',
    timeLimit: 2000,
    memoryLimit: 256,
    partialScoring: false
  });

  const [customCodingTestCases, setCustomCodingTestCases] = useState<CodingTestCaseForm[]>([
    { input: '', expectedOutput: '', isHidden: false, marks: 0 }
  ]);

  const [customBehavioral, setCustomBehavioral] = useState({
    title: '',
    description: '',
    expectedAnswer: ''
  });

  useEffect(() => {
    loadTest();
  }, [testId]);


  const loadTest = async () => {
    try {
      const { data } = await adminApi.getTest(testId!);
      setTest(data.test);
      setQuestions(data.test.questions || []);
      setSections(data.test.sections || []);
    } catch (error) {
      toast.error('Failed to load test');
    } finally {
      setLoading(false);
    }
  };

  const toggleActive = async () => {
    if (!test) return;
    try {
      await adminApi.updateTest(test.id, { isActive: !test.isActive });
      setTest((prev) => (prev ? { ...prev, isActive: !prev.isActive } : prev));
      toast.success(`Test ${test.isActive ? 'deactivated' : 'activated'}`);
    } catch (error) {
      toast.error('Failed to update test');
    }
  };

  const showCandidates = () => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'candidates');
    next.delete('view');
    setSearchParams(next, { replace: true });
  };

  const openInviteModal = () => {
    setShowInviteModal(true);
    setInvitationFile(null);
    setCustomMessage('');
    setInvitationSummary(null);
  };

  const closeInviteModal = () => {
    if (sendingInvitations) {
      return;
    }
    setShowInviteModal(false);
    setInvitationFile(null);
    setCustomMessage('');
    setInvitationSummary(null);
  };

  const handleSendInvitations = async () => {
    if (!testId) {
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
      const { data } = await adminApi.sendInvitations(testId, formData);
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

  const isCandidatesView = searchParams.get('tab') === 'candidates';

  const loadAvailableQuestions = async (type: 'mcq' | 'coding' | 'behavioral') => {
    try {
      if (type === 'mcq') {
        const { data } = await adminApi.getMCQs(1, 100);
        setAvailableQuestions(data.questions);
      } else if (type === 'coding') {
        const { data } = await adminApi.getCodings(1, 100);
        setAvailableQuestions(data.questions);
      } else {
        const { data } = await adminApi.getBehaviorals(1, 100);
        setAvailableQuestions(data.questions);
      }
    } catch (error) {
      toast.error('Failed to load questions');
    }
  };

  const handleCreateSection = async () => {
    if (!newSectionName.trim()) {
      toast.error('Section name is required');
      return;
    }

    setCreatingSection(true);
    try {
      await adminApi.createTestSection(testId!, { name: newSectionName.trim() });
      toast.success('Section created');
      setShowSectionModal(false);
      setNewSectionName('');
      await loadTest();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to create section');
    } finally {
      setCreatingSection(false);
    }
  };

  const handleDeleteSection = async (sectionId: string) => {
    if (!confirm('Delete this section and remove its questions from the test?')) return;

    try {
      await adminApi.deleteTestSection(testId!, sectionId);
      toast.success('Section deleted');
      await loadTest();
    } catch (error) {
      toast.error('Failed to delete section');
    }
  };

  const handleAddQuestion = async () => {
    if (!selectedQuestion) {
      toast.error('Please select a question');
      return;
    }

    try {
      await adminApi.addQuestionToTest(testId!, {
        questionId: selectedQuestion,
        questionType,
        sectionId: activeSectionId || undefined
      });
      toast.success('Question added to test');
      setShowAddModal(false);
      setSelectedQuestion('');
      setActiveSectionId(null);
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
      toast.success('Question removed');
      loadTest();
    } catch (error) {
      toast.error('Failed to remove question');
    }
  };

  const openAddModal = (type: 'mcq' | 'coding' | 'behavioral', sectionId?: string | null) => {
    setQuestionType(type);
    setShowAddModal(true);
    setSelectedQuestion('');
    setAvailableQuestions([]);
    setActiveSectionId(sectionId ?? null);
    loadAvailableQuestions(type);
  };

  const resetCustomForm = () => {
    setCustomType('mcq');
    setCustomMarks(5);
    setCustomDifficulty('medium');
    setCustomTopic('');
    setCustomTags('');
    setCustomMCQ({
      questionText: '',
      options: ['', '', '', ''],
      correctAnswers: '',
      isMultipleChoice: false,
      explanation: ''
    });
    setCustomCoding({
      title: '',
      description: '',
      inputFormat: '',
      outputFormat: '',
      constraints: '',
      sampleInput: '',
      sampleOutput: '',
      supportedLanguages: 'python,javascript',
      timeLimit: 2000,
      memoryLimit: 256,
      partialScoring: false
    });
    setCustomCodingTestCases([{ input: '', expectedOutput: '', isHidden: false, marks: 0 }]);
    setCustomBehavioral({
      title: '',
      description: '',
      expectedAnswer: ''
    });
  };

  const handleOpenCustomModal = (sectionId?: string | null) => {
    resetCustomForm();
    setShowCustomModal(true);
    setActiveSectionId(sectionId ?? null);
  };

  const setMCQOption = (index: number, value: string) => {
    setCustomMCQ((prev) => {
      const options = [...prev.options];
      options[index] = value;
      return { ...prev, options };
    });
  };

  const addMCQOption = () => {
    setCustomMCQ((prev) => {
      if (prev.options.length >= 6) return prev;
      return { ...prev, options: [...prev.options, ''] };
    });
  };

  const removeMCQOption = (index: number) => {
    setCustomMCQ((prev) => {
      if (prev.options.length <= 2) return prev;
      const options = prev.options.filter((_, idx) => idx !== index);
      return { ...prev, options };
    });
  };

  const setCodingTestCaseField = <K extends keyof CodingTestCaseForm>(
    index: number,
    key: K,
    value: CodingTestCaseForm[K]
  ) => {
    setCustomCodingTestCases((prev) =>
      prev.map((tc, idx) => (idx === index ? { ...tc, [key]: value } : tc))
    );
  };

  const addCodingTestCase = () => {
    setCustomCodingTestCases((prev) => [
      ...prev,
      { input: '', expectedOutput: '', isHidden: false, marks: 0 }
    ]);
  };

  const removeCodingTestCase = (index: number) => {
    setCustomCodingTestCases((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, idx) => idx !== index);
    });
  };

  const parseTagInput = () =>
    customTags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

  const handleAddCustomQuestion = async () => {
    if (!testId) return;

    setSavingCustom(true);
    try {
      const common = {
        marks: customMarks,
        difficulty: customDifficulty,
        topic: customTopic.trim() || undefined,
        tags: parseTagInput(),
        sectionId: activeSectionId || undefined
      };

      if (customType === 'mcq') {
        const cleanedOptions = customMCQ.options
          .map((option) => option.trim())
          .filter((option) => option.length > 0);

        const correctAnswers = customMCQ.correctAnswers
          .split(',')
          .map((item) => Number.parseInt(item.trim(), 10))
          .filter((item) => Number.isInteger(item) && item > 0)
          .map((item) => item - 1);

        await adminApi.addCustomQuestionToTest(testId, {
          questionType: 'mcq',
          questionText: customMCQ.questionText,
          options: cleanedOptions,
          correctAnswers,
          isMultipleChoice: customMCQ.isMultipleChoice,
          explanation: customMCQ.explanation.trim() || undefined,
          ...common
        });
      } else if (customType === 'coding') {
        const supportedLanguages = customCoding.supportedLanguages
          .split(',')
          .map((lang) => lang.trim().toLowerCase())
          .filter((lang) => lang.length > 0);

        const testCases = customCodingTestCases
          .map((tc) => ({
            input: tc.input,
            expectedOutput: tc.expectedOutput,
            isHidden: tc.isHidden,
            marks: tc.marks
          }))
          .filter((tc) => tc.input.trim().length > 0 && tc.expectedOutput.trim().length > 0);

        await adminApi.addCustomQuestionToTest(testId, {
          questionType: 'coding',
          title: customCoding.title,
          description: customCoding.description,
          inputFormat: customCoding.inputFormat,
          outputFormat: customCoding.outputFormat,
          constraints: customCoding.constraints.trim() || undefined,
          sampleInput: customCoding.sampleInput,
          sampleOutput: customCoding.sampleOutput,
          supportedLanguages,
          timeLimit: customCoding.timeLimit,
          memoryLimit: customCoding.memoryLimit,
          partialScoring: customCoding.partialScoring,
          testCases,
          ...common
        });
      } else {
        await adminApi.addCustomQuestionToTest(testId, {
          questionType: 'behavioral',
          title: customBehavioral.title,
          description: customBehavioral.description,
          expectedAnswer: customBehavioral.expectedAnswer.trim() || undefined,
          ...common
        });
      }

      toast.success('Custom question added to test');
      setShowCustomModal(false);
      resetCustomForm();
      setActiveSectionId(null);
      await loadTest();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string; errors?: Array<{ msg?: string }> } } };
      const validationMessage = err.response?.data?.errors?.[0]?.msg;
      toast.error(validationMessage || err.response?.data?.error || 'Failed to add custom question');
    } finally {
      setSavingCustom(false);
    }
  };

  const activeSection = activeSectionId
    ? sections.find((section) => section.id === activeSectionId) || null
    : null;

  const unsectionedQuestions = questions.filter((q) => !q.sectionId);
  const questionSections = [
    ...sections.map((section, index) => ({
      id: section.id,
      title: `Section ${index + 1}: ${section.name}`,
      subtitle: `Picks 1 question per candidate (pool: ${section.questions?.length || 0})`,
      questions: section.questions || [],
      sectionId: section.id,
      isGeneral: false
    })),
    ...(unsectionedQuestions.length > 0
      ? [
          {
            id: 'general',
            title: 'General Questions',
            subtitle: 'These questions appear for every candidate.',
            questions: unsectionedQuestions,
            sectionId: null,
            isGeneral: true
          }
        ]
      : [])
  ];

  const getQuestionKey = (q: TestQuestion) => {
    if (q.questionType === 'mcq' && q.mcqQuestion?.id) return `mcq:${q.mcqQuestion.id}`;
    if (q.questionType === 'coding' && q.codingQuestion?.id) return `coding:${q.codingQuestion.id}`;
    if (q.questionType === 'behavioral' && q.behavioralQuestion?.id) return `behavioral:${q.behavioralQuestion.id}`;
    return null;
  };

  const sectionUsageMap = sections.reduce((map, section, index) => {
    const sectionNumber = index + 1;
    (section.questions || []).forEach((q) => {
      const key = getQuestionKey(q);
      if (!key) return;
      const existing = map.get(key) || [];
      if (!existing.includes(sectionNumber)) {
        existing.push(sectionNumber);
      }
      map.set(key, existing);
    });
    return map;
  }, new Map<string, number[]>());

  const selectedQuestionUsage = selectedQuestion
    ? sectionUsageMap.get(`${questionType}:${selectedQuestion}`) || null
    : null;

  const typeCoverageWarning = (() => {
    if (sections.length === 0) return null;
    const targetTypes = ['mcq', 'coding', 'behavioral'] as const;
    type SectionType = typeof targetTypes[number];

    const sectionTypeMap = sections.map((section) => {
      const typeSet = new Set<SectionType>();
      (section.questions || []).forEach((q) => {
        if (q.questionType === 'mcq' || q.questionType === 'coding' || q.questionType === 'behavioral') {
          typeSet.add(q.questionType);
        }
      });
      return { id: section.id, typeSet };
    });

    const emptySections = sections
      .map((section, index) => ({ count: (section.questions || []).length, number: index + 1 }))
      .filter((item) => item.count === 0)
      .map((item) => item.number);

    if (emptySections.length > 0) {
      return `Warning: Section${emptySections.length > 1 ? 's' : ''} ${emptySections.join(', ')} have no questions. Each section must include at least one question.`;
    }

    const sectionsByType = new Map<SectionType, string[]>();
    targetTypes.forEach((type) => {
      sectionsByType.set(
        type,
        sectionTypeMap.filter((section) => section.typeSet.has(type)).map((section) => section.id)
      );
    });

    const assignedTypeBySection = new Map<string, SectionType>();
    const assignedSectionByType = new Map<SectionType, string>();
    const typesByScarcity = [...targetTypes].sort((a, b) => {
      const countA = sectionsByType.get(a)?.length || 0;
      const countB = sectionsByType.get(b)?.length || 0;
      return countA - countB;
    });

    const tryAssign = (type: SectionType, visited: Set<string>): boolean => {
      const candidates = sectionsByType.get(type) || [];
      for (const sectionId of candidates) {
        if (visited.has(sectionId)) continue;
        visited.add(sectionId);
        const currentType = assignedTypeBySection.get(sectionId);
        if (!currentType || tryAssign(currentType, visited)) {
          assignedTypeBySection.set(sectionId, type);
          assignedSectionByType.set(type, sectionId);
          return true;
        }
      }
      return false;
    };

    for (const type of typesByScarcity) {
      tryAssign(type, new Set<string>());
    }

    if (assignedSectionByType.size === targetTypes.length) return null;

    return 'Warning: Question types are unbalanced across sections. Check question types added per section.';
  })();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!test) {
    return <div className="text-center py-12">Test not found</div>;
  }

  return (
    <div className="space-y-6">
      <div className="text-sm text-slate-500">
        <Link to="/admin/tests" className="text-emerald-600 hover:underline">
          Tests
        </Link>
        <span className="mx-2">›</span>
        <span className="text-slate-600">{test.name}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">{test.name}</h1>
          <p className="text-sm text-slate-500">
            Code: <span className="font-mono font-semibold text-slate-700">{test.testCode}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={toggleActive}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {test.isActive ? 'Deactivate' : 'Activate'}
          </button>
          <button
            onClick={openInviteModal}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Invite
          </button>
          <Link
            to={`/admin/tests/${testId}/edit`}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Edit Test
          </Link>
          <button className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50">
            <span className="text-xl leading-none">⋯</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-6 border-b border-slate-200 text-sm">
        <button
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.delete('tab');
            next.delete('view');
            setSearchParams(next, { replace: true });
          }}
          className={`relative pb-3 font-semibold ${
            !isCandidatesView ? 'text-slate-900 after:absolute after:-bottom-[1px] after:left-0 after:h-[3px] after:w-full after:bg-emerald-500' : 'text-slate-500'
          }`}
        >
          Questions
        </button>
        <button
          onClick={showCandidates}
          className={`relative pb-3 font-semibold ${
            isCandidatesView
              ? 'text-slate-900 after:absolute after:-bottom-[1px] after:left-0 after:h-[3px] after:w-full after:bg-emerald-500'
              : 'text-slate-500'
          }`}
        >
          Candidates
        </button>
        <Link
          to={`/admin/tests/${testId}/analytics`}
          className="pb-3 font-semibold text-slate-500 hover:text-slate-900"
        >
          Insights
        </Link>
        <Link
          to={`/admin/tests/${testId}/settings`}
          className="pb-3 font-semibold text-slate-500 hover:text-slate-900"
        >
          Settings
        </Link>
      </div>

      {isCandidatesView ? (
        <TestCandidatesPanel testId={testId!} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr,320px]">
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
              <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                <div className="font-semibold text-slate-900">Test duration:</div>
                <div>{test.duration} mins</div>
                <div className="text-slate-300">|</div>
                <div>Total Marks: {test.totalMarks}</div>
                <div className="text-slate-300">|</div>
                <div>Passing: {test.passingMarks || 'N/A'}</div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Questions ({questions.length})</h2>
                  <p className="text-xs text-slate-500">Organize and manage questions for this test.</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    onClick={() => setShowSectionModal(true)}
                    className="rounded-full border border-slate-200 px-3 py-1 font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Create Section +
                  </button>
                  <button
                    onClick={() => openAddModal('mcq')}
                    className="rounded-full border border-slate-200 px-3 py-1 font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Add Existing MCQ
                  </button>
                  <button
                    onClick={() => openAddModal('coding')}
                    className="rounded-full border border-slate-200 px-3 py-1 font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Add Existing Coding
                  </button>
                  <button
                    onClick={() => openAddModal('behavioral')}
                    className="rounded-full border border-slate-200 px-3 py-1 font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Add Existing Behavioral
                  </button>
                  <button
                    onClick={() => handleOpenCustomModal()}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-700 hover:bg-emerald-100"
                  >
                    Create Question
                  </button>
                </div>
              </div>

              {typeCoverageWarning && (
                <div className="mx-5 mt-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  {typeCoverageWarning}
                </div>
              )}

              {sections.length === 0 && unsectionedQuestions.length === 0 ? (
                <div className="px-5 py-12 text-center text-slate-500">
                  No questions added yet. Add existing or custom questions to this test.
                </div>
              ) : (
                <div className="space-y-6 px-5 pb-6 pt-4">
                  {sections.length > 0 &&
                    sections.map((section, sectionIndex) => (
                      <div key={section.id} className="rounded-2xl border border-slate-200 bg-slate-50/60">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                          <div>
                            <h3 className="text-sm font-semibold text-slate-900">
                              Section {sectionIndex + 1}: {section.name}
                            </h3>
                            <p className="text-xs text-slate-500">
                              Picks 1 question per candidate (pool: {section.questions?.length || 0})
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
                            <button
                              onClick={() => openAddModal('mcq', section.id)}
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600 hover:bg-slate-50"
                            >
                              Add MCQ
                            </button>
                            <button
                              onClick={() => openAddModal('coding', section.id)}
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600 hover:bg-slate-50"
                            >
                              Add Coding
                            </button>
                            <button
                              onClick={() => openAddModal('behavioral', section.id)}
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600 hover:bg-slate-50"
                            >
                              Add Behavioral
                            </button>
                            <button
                              onClick={() => handleOpenCustomModal(section.id)}
                              className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700 hover:bg-emerald-100"
                            >
                              Create
                            </button>
                            <button
                              onClick={() => handleDeleteSection(section.id)}
                              className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-rose-600 hover:bg-rose-100"
                            >
                              Delete
                            </button>
                          </div>
                        </div>

                        {section.questions && section.questions.length > 0 ? (
                          <div>
                            <div className="grid grid-cols-[minmax(220px,1fr)_110px_90px_120px_70px_80px] gap-4 border-b border-slate-200 bg-white/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              <span>Questions</span>
                              <span>Type</span>
                              <span>Time</span>
                              <span>Skills</span>
                              <span>Score</span>
                              <span>Action</span>
                            </div>
                            <div className="divide-y divide-slate-200 bg-white">
                              {section.questions.map((q, index) => {
                                const questionKey = getQuestionKey(q);
                                const usage = questionKey ? sectionUsageMap.get(questionKey) : null;
                                const showUsage = usage && usage.length > 1;
                                const marks =
                                  q.mcqQuestion?.marks || q.codingQuestion?.marks || q.behavioralQuestion?.marks;
                                return (
                                  <div
                                    key={q.id}
                                    className="grid grid-cols-[minmax(220px,1fr)_110px_90px_120px_70px_80px] gap-4 px-4 py-3 text-sm"
                                  >
                                    <div className="min-w-0">
                                      <p className="font-medium text-slate-900">
                                        {q.questionType === 'mcq'
                                          ? q.mcqQuestion?.questionText
                                          : q.questionType === 'coding'
                                            ? q.codingQuestion?.title
                                            : q.behavioralQuestion?.title}
                                      </p>
                                      {showUsage && (
                                        <p className="text-xs text-amber-600">
                                          Used in sections {usage?.join(', ')}
                                        </p>
                                      )}
                                    </div>
                                    <span className="text-slate-600">{q.questionType.toUpperCase()}</span>
                                    <span className="text-slate-500">-</span>
                                    <span className="text-slate-500">N/A</span>
                                    <span className="font-semibold text-slate-700">{marks}</span>
                                    <button
                                      onClick={() => handleRemoveQuestion(q.id)}
                                      className="text-rose-600 hover:text-rose-700"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <p className="px-4 py-6 text-sm text-slate-500">No questions in this section yet.</p>
                        )}
                      </div>
                    ))}

                  {unsectionedQuestions.length > 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/60">
                      <div className="border-b border-slate-200 px-4 py-3">
                        <h3 className="text-sm font-semibold text-slate-900">General Questions</h3>
                        <p className="text-xs text-slate-500">These questions appear for every candidate.</p>
                      </div>
                      <div className="grid grid-cols-[minmax(220px,1fr)_110px_90px_120px_70px_80px] gap-4 border-b border-slate-200 bg-white/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        <span>Questions</span>
                        <span>Type</span>
                        <span>Time</span>
                        <span>Skills</span>
                        <span>Score</span>
                        <span>Action</span>
                      </div>
                      <div className="divide-y divide-slate-200 bg-white">
                        {unsectionedQuestions.map((q) => {
                          const marks =
                            q.mcqQuestion?.marks || q.codingQuestion?.marks || q.behavioralQuestion?.marks;
                          return (
                            <div
                              key={q.id}
                              className="grid grid-cols-[minmax(220px,1fr)_110px_90px_120px_70px_80px] gap-4 px-4 py-3 text-sm"
                            >
                              <div className="min-w-0">
                                <p className="font-medium text-slate-900">
                                  {q.questionType === 'mcq'
                                    ? q.mcqQuestion?.questionText
                                    : q.questionType === 'coding'
                                      ? q.codingQuestion?.title
                                      : q.behavioralQuestion?.title}
                                </p>
                              </div>
                              <span className="text-slate-600">{q.questionType.toUpperCase()}</span>
                              <span className="text-slate-500">-</span>
                              <span className="text-slate-500">N/A</span>
                              <span className="font-semibold text-slate-700">{marks}</span>
                              <button
                                onClick={() => handleRemoveQuestion(q.id)}
                                className="text-rose-600 hover:text-rose-700"
                              >
                                Remove
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">Role</h3>
              <p className="mt-2 text-sm text-slate-600">
                {test.description?.trim() ? test.description : 'Software Engineer'}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">Test Summary</h3>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <div className="flex items-center justify-between">
                  <span>Status</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    test.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                  }`}>
                    {test.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Start</span>
                  <span>{format(new Date(test.startTime), 'MMM d, yyyy')}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>End</span>
                  <span>{test.endTime ? format(new Date(test.endTime), 'MMM d, yyyy') : 'No end time'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Negative marking</span>
                  <span>{test.negativeMarking}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Max violations</span>
                  <span>{test.maxViolations}</span>
                </div>
              </div>
            </div>
            {test.instructions && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">Instructions</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{test.instructions}</p>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Add Section Modal */}
      {!isCandidatesView && showSectionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="card w-full max-w-lg">
            <h3 className="text-lg font-semibold mb-2">Add Section</h3>
            <p className="text-sm text-gray-500 mb-4">
              Each section will randomly pick 1 question per candidate.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Section Name
              </label>
              <input
                type="text"
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                className="input"
                placeholder="e.g. Frontend Fundamentals"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowSectionModal(false);
                  setNewSectionName('');
                }}
                className="btn btn-secondary"
                disabled={creatingSection}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateSection}
                className="btn btn-primary"
                disabled={creatingSection}
              >
                {creatingSection ? 'Creating...' : 'Create Section'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Existing Question Modal */}
      {!isCandidatesView && showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="card w-full max-w-2xl max-h-[80vh] overflow-auto">
            <h3 className="text-lg font-semibold mb-4">
              Add Existing {questionType === 'mcq'
                ? 'MCQ'
                : questionType === 'coding'
                  ? 'Coding'
                  : 'Behavioral / Situational'} Question
            </h3>
            {activeSection && (
              <p className="text-sm text-gray-500 mb-4">
                Adding to section: <span className="font-medium text-gray-700">{activeSection.name}</span>
              </p>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Question
              </label>
              <select
                value={selectedQuestion}
                onChange={(e) => setSelectedQuestion(e.target.value)}
                className="input"
              >
                <option value="">Select a question...</option>
                {availableQuestions.map((q) => {
                  const usage = sectionUsageMap.get(`${questionType}:${q.id}`);
                  const usageLabel = usage && usage.length > 0
                    ? ` • Used in section${usage.length > 1 ? 's' : ''} ${usage.join(', ')}`
                    : '';
                  return (
                    <option key={q.id} value={q.id}>
                      {questionType === 'mcq'
                        ? (q as MCQQuestion).questionText.substring(0, 100)
                        : questionType === 'coding'
                          ? (q as CodingQuestion).title
                          : (q as BehavioralQuestion).title}
                      {' '}({q.marks} marks){usageLabel}
                    </option>
                  );
                })}
              </select>
            </div>
            {selectedQuestionUsage && selectedQuestionUsage.length > 0 && (
              <p className="text-sm text-amber-600 mb-4">
                This question is already used in section{selectedQuestionUsage.length > 1 ? 's' : ''} {selectedQuestionUsage.join(', ')}.
              </p>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setSelectedQuestion('');
                  setActiveSectionId(null);
                }}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button onClick={handleAddQuestion} className="btn btn-primary">
                Add Question
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Custom Question Modal */}
      {!isCandidatesView && showCustomModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="card w-full max-w-3xl max-h-[90vh] overflow-auto">
            <h3 className="text-lg font-semibold mb-4">Add Custom Question</h3>
            {activeSection && (
              <p className="text-sm text-gray-500 mb-4">
                Adding to section: <span className="font-medium text-gray-700">{activeSection.name}</span>
              </p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Question Type</label>
                <select
                  value={customType}
                  onChange={(e) => setCustomType(e.target.value as 'mcq' | 'coding' | 'behavioral')}
                  className="input"
                >
                  <option value="mcq">MCQ</option>
                  <option value="coding">Coding</option>
                  <option value="behavioral">Behavioral / Situational</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Marks</label>
                <input
                  type="number"
                  min={1}
                  value={customMarks}
                  onChange={(e) => setCustomMarks(Number(e.target.value))}
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Difficulty</label>
                <select
                  value={customDifficulty}
                  onChange={(e) => setCustomDifficulty(e.target.value as 'easy' | 'medium' | 'hard')}
                  className="input"
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Topic (optional)</label>
                <input
                  type="text"
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  className="input"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Tags (comma separated)</label>
              <input
                type="text"
                value={customTags}
                onChange={(e) => setCustomTags(e.target.value)}
                className="input"
                placeholder="communication, problem-solving, sql"
              />
            </div>

            {customType === 'mcq' && (
              <div className="space-y-4 border rounded-lg p-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Question Text</label>
                  <textarea
                    className="input min-h-[90px]"
                    value={customMCQ.questionText}
                    onChange={(e) => setCustomMCQ((prev) => ({ ...prev, questionText: e.target.value }))}
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-medium text-gray-700">Options</label>
                    <button type="button" onClick={addMCQOption} className="btn btn-secondary text-xs">
                      Add Option
                    </button>
                  </div>
                  <div className="space-y-2">
                    {customMCQ.options.map((option, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <span className="text-sm text-gray-500 w-6">{idx + 1}.</span>
                        <input
                          type="text"
                          value={option}
                          onChange={(e) => setMCQOption(idx, e.target.value)}
                          className="input"
                        />
                        <button
                          type="button"
                          onClick={() => removeMCQOption(idx)}
                          className="btn btn-danger text-xs"
                          disabled={customMCQ.options.length <= 2}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Correct Option Numbers (e.g. 1 or 1,3)
                    </label>
                    <input
                      type="text"
                      value={customMCQ.correctAnswers}
                      onChange={(e) => setCustomMCQ((prev) => ({ ...prev, correctAnswers: e.target.value }))}
                      className="input"
                    />
                  </div>
                  <label className="flex items-center gap-2 mt-7">
                    <input
                      type="checkbox"
                      checked={customMCQ.isMultipleChoice}
                      onChange={(e) => setCustomMCQ((prev) => ({ ...prev, isMultipleChoice: e.target.checked }))}
                    />
                    <span>Multiple correct answers</span>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Explanation (optional)</label>
                  <textarea
                    className="input min-h-[80px]"
                    value={customMCQ.explanation}
                    onChange={(e) => setCustomMCQ((prev) => ({ ...prev, explanation: e.target.value }))}
                  />
                </div>
              </div>
            )}

            {customType === 'coding' && (
              <div className="space-y-4 border rounded-lg p-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                  <input
                    type="text"
                    className="input"
                    value={customCoding.title}
                    onChange={(e) => setCustomCoding((prev) => ({ ...prev, title: e.target.value }))}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    className="input min-h-[100px]"
                    value={customCoding.description}
                    onChange={(e) => setCustomCoding((prev) => ({ ...prev, description: e.target.value }))}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Input Format</label>
                    <textarea
                      className="input min-h-[70px]"
                      value={customCoding.inputFormat}
                      onChange={(e) => setCustomCoding((prev) => ({ ...prev, inputFormat: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Output Format</label>
                    <textarea
                      className="input min-h-[70px]"
                      value={customCoding.outputFormat}
                      onChange={(e) => setCustomCoding((prev) => ({ ...prev, outputFormat: e.target.value }))}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Constraints (optional)</label>
                  <textarea
                    className="input min-h-[70px]"
                    value={customCoding.constraints}
                    onChange={(e) => setCustomCoding((prev) => ({ ...prev, constraints: e.target.value }))}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Sample Input</label>
                    <textarea
                      className="input min-h-[70px]"
                      value={customCoding.sampleInput}
                      onChange={(e) => setCustomCoding((prev) => ({ ...prev, sampleInput: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Sample Output</label>
                    <textarea
                      className="input min-h-[70px]"
                      value={customCoding.sampleOutput}
                      onChange={(e) => setCustomCoding((prev) => ({ ...prev, sampleOutput: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Languages (comma separated)</label>
                    <input
                      type="text"
                      className="input"
                      value={customCoding.supportedLanguages}
                      onChange={(e) => setCustomCoding((prev) => ({ ...prev, supportedLanguages: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Time Limit (ms)</label>
                    <input
                      type="number"
                      min={1}
                      className="input"
                      value={customCoding.timeLimit}
                      onChange={(e) => setCustomCoding((prev) => ({ ...prev, timeLimit: Number(e.target.value) }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Memory Limit (MB)</label>
                    <input
                      type="number"
                      min={1}
                      className="input"
                      value={customCoding.memoryLimit}
                      onChange={(e) => setCustomCoding((prev) => ({ ...prev, memoryLimit: Number(e.target.value) }))}
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={customCoding.partialScoring}
                    onChange={(e) => setCustomCoding((prev) => ({ ...prev, partialScoring: e.target.checked }))}
                  />
                  <span>Enable partial scoring</span>
                </label>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-medium">Test Cases</h4>
                    <button type="button" onClick={addCodingTestCase} className="btn btn-secondary text-xs">
                      Add Test Case
                    </button>
                  </div>
                  <div className="space-y-3">
                    {customCodingTestCases.map((testCase, idx) => (
                      <div key={idx} className="border rounded p-3 space-y-2">
                        <div className="flex justify-between items-center">
                          <p className="text-sm font-medium">Test Case {idx + 1}</p>
                          <button
                            type="button"
                            onClick={() => removeCodingTestCase(idx)}
                            className="btn btn-danger text-xs"
                            disabled={customCodingTestCases.length <= 1}
                          >
                            Remove
                          </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <textarea
                            className="input min-h-[60px]"
                            placeholder="Input"
                            value={testCase.input}
                            onChange={(e) => setCodingTestCaseField(idx, 'input', e.target.value)}
                          />
                          <textarea
                            className="input min-h-[60px]"
                            placeholder="Expected Output"
                            value={testCase.expectedOutput}
                            onChange={(e) => setCodingTestCaseField(idx, 'expectedOutput', e.target.value)}
                          />
                        </div>
                        <div className="flex gap-4">
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={testCase.isHidden}
                              onChange={(e) => setCodingTestCaseField(idx, 'isHidden', e.target.checked)}
                            />
                            Hidden test case
                          </label>
                          <input
                            type="number"
                            min={0}
                            className="input w-28"
                            value={testCase.marks}
                            onChange={(e) => setCodingTestCaseField(idx, 'marks', Number(e.target.value))}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {customType === 'behavioral' && (
              <div className="space-y-4 border rounded-lg p-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                  <input
                    type="text"
                    className="input"
                    value={customBehavioral.title}
                    onChange={(e) => setCustomBehavioral((prev) => ({ ...prev, title: e.target.value }))}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Question Description</label>
                  <textarea
                    className="input min-h-[120px]"
                    value={customBehavioral.description}
                    onChange={(e) => setCustomBehavioral((prev) => ({ ...prev, description: e.target.value }))}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expected Answer (optional)</label>
                  <textarea
                    className="input min-h-[90px]"
                    value={customBehavioral.expectedAnswer}
                    onChange={(e) => setCustomBehavioral((prev) => ({ ...prev, expectedAnswer: e.target.value }))}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end mt-6">
              <button
                onClick={() => {
                  setShowCustomModal(false);
                  resetCustomForm();
                  setActiveSectionId(null);
                }}
                className="btn btn-secondary"
                disabled={savingCustom}
              >
                Cancel
              </button>
              <button
                onClick={handleAddCustomQuestion}
                className="btn btn-primary"
                disabled={savingCustom}
              >
                {savingCustom ? 'Adding...' : 'Add Custom Question'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="card w-full max-w-2xl">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">Send Invitations</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Upload a CSV or XLSX file with <span className="font-mono">name,email</span> columns for{' '}
                  <span className="font-medium">{test?.name}</span>.
                </p>
              </div>
              <button
                onClick={closeInviteModal}
                disabled={sendingInvitations}
                className="text-gray-500 hover:text-gray-700 text-xl leading-none"
                aria-label="Close"
              >
                ×
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
                onClick={closeInviteModal}
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
