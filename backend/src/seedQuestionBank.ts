import { QuestionRepositoryCategory, QuestionSource } from '@prisma/client';
import prisma from './utils/db.js';

type MCQSeed = {
  id: string;
  questionText: string;
  options: string[];
  correctAnswers: number[];
  marks: number;
  isMultipleChoice: boolean;
  explanation?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
  tags: string[];
};

type CodingTestCaseSeed = {
  input: string;
  expectedOutput: string;
  isHidden?: boolean;
  marks: number;
};

type CodingSeed = {
  id: string;
  title: string;
  description: string;
  inputFormat: string;
  outputFormat: string;
  constraints?: string;
  sampleInput: string;
  sampleOutput: string;
  marks: number;
  timeLimit: number;
  memoryLimit: number;
  supportedLanguages: string[];
  partialScoring: boolean;
  autoEvaluate: boolean;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
  tags: string[];
  testCases: CodingTestCaseSeed[];
};

type BehavioralSeed = {
  id: string;
  title: string;
  description: string;
  expectedAnswer: string;
  marks: number;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
  tags: string[];
};

const mcqQuestions: MCQSeed[] = [
  {
    id: '11111111-1111-4111-8111-111111111001',
    questionText: 'What is the time complexity of binary search in a sorted array?',
    options: ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'],
    correctAnswers: [1],
    marks: 5,
    isMultipleChoice: false,
    explanation: 'Binary search halves the search space each step.',
    difficulty: 'easy',
    topic: 'Algorithms',
    tags: ['binary-search', 'time-complexity']
  },
  {
    id: '11111111-1111-4111-8111-111111111002',
    questionText: 'Which SQL clause is used to filter grouped records?',
    options: ['WHERE', 'GROUP BY', 'HAVING', 'ORDER BY'],
    correctAnswers: [2],
    marks: 5,
    isMultipleChoice: false,
    difficulty: 'easy',
    topic: 'Databases',
    tags: ['sql', 'aggregation']
  },
  {
    id: '11111111-1111-4111-8111-111111111003',
    questionText: 'Which of the following are valid HTTP methods?',
    options: ['GET', 'FETCH', 'POST', 'DELETE'],
    correctAnswers: [0, 2, 3],
    marks: 10,
    isMultipleChoice: true,
    difficulty: 'easy',
    topic: 'Web',
    tags: ['http', 'rest']
  },
  {
    id: '11111111-1111-4111-8111-111111111004',
    questionText: 'What does ACID stand for in databases?',
    options: [
      'Atomicity, Consistency, Isolation, Durability',
      'Availability, Consistency, Isolation, Durability',
      'Atomicity, Concurrency, Isolation, Durability',
      'Accuracy, Consistency, Integrity, Durability'
    ],
    correctAnswers: [0],
    marks: 5,
    isMultipleChoice: false,
    difficulty: 'medium',
    topic: 'Databases',
    tags: ['acid', 'transactions']
  },
  {
    id: '11111111-1111-4111-8111-111111111005',
    questionText: 'Which data structure is best suited for implementing LRU cache?',
    options: ['Array + Stack', 'HashMap + Doubly Linked List', 'Queue only', 'Binary Heap'],
    correctAnswers: [1],
    marks: 10,
    isMultipleChoice: false,
    difficulty: 'medium',
    topic: 'Data Structures',
    tags: ['lru-cache', 'hashmap', 'linked-list']
  },
  {
    id: '11111111-1111-4111-8111-111111111006',
    questionText: 'In object-oriented design, which principles are part of SOLID?',
    options: [
      'Single Responsibility Principle',
      'Open/Closed Principle',
      'Binary Search Principle',
      'Dependency Inversion Principle'
    ],
    correctAnswers: [0, 1, 3],
    marks: 10,
    isMultipleChoice: true,
    difficulty: 'medium',
    topic: 'System Design',
    tags: ['solid', 'oop']
  },
  {
    id: '11111111-1111-4111-8111-111111111007',
    questionText: 'What is the primary purpose of indexing in relational databases?',
    options: [
      'Increase write latency intentionally',
      'Reduce storage usage',
      'Speed up query performance',
      'Replace normalization'
    ],
    correctAnswers: [2],
    marks: 5,
    isMultipleChoice: false,
    difficulty: 'easy',
    topic: 'Databases',
    tags: ['indexing', 'query-optimization']
  },
  {
    id: '11111111-1111-4111-8111-111111111008',
    questionText: 'Which sorting algorithms have average-case O(n log n) complexity?',
    options: ['Merge Sort', 'Quick Sort', 'Bubble Sort', 'Heap Sort'],
    correctAnswers: [0, 1, 3],
    marks: 10,
    isMultipleChoice: true,
    difficulty: 'medium',
    topic: 'Algorithms',
    tags: ['sorting', 'complexity']
  },
  {
    id: '11111111-1111-4111-8111-111111111009',
    questionText: 'What is the output of 2 ** 3 in JavaScript?',
    options: ['6', '8', '9', 'Error'],
    correctAnswers: [1],
    marks: 5,
    isMultipleChoice: false,
    difficulty: 'easy',
    topic: 'JavaScript',
    tags: ['operators', 'javascript-basics']
  },
  {
    id: '11111111-1111-4111-8111-111111111010',
    questionText: 'Which practices improve API security?',
    options: ['Input validation', 'Rate limiting', 'Store plaintext passwords', 'Use TLS'],
    correctAnswers: [0, 1, 3],
    marks: 10,
    isMultipleChoice: true,
    difficulty: 'hard',
    topic: 'Security',
    tags: ['api-security', 'best-practices']
  }
];

const codingQuestions: CodingSeed[] = [
  {
    id: '22222222-2222-4222-8222-222222222001',
    title: 'Two Sum Indices',
    description: 'Given an integer array and a target, return indices of two numbers that add up to target.',
    inputFormat: 'First line: n. Second line: n space-separated integers. Third line: target.',
    outputFormat: 'Two space-separated indices in ascending order.',
    constraints: '2 <= n <= 10^5',
    sampleInput: '4\n2 7 11 15\n9',
    sampleOutput: '0 1',
    marks: 20,
    timeLimit: 2000,
    memoryLimit: 256,
    supportedLanguages: ['python', 'javascript', 'java', 'cpp'],
    partialScoring: false,
    autoEvaluate: true,
    difficulty: 'easy',
    topic: 'Arrays',
    tags: ['hashmap', 'arrays'],
    testCases: [
      { input: '4\n2 7 11 15\n9', expectedOutput: '0 1', marks: 8 },
      { input: '3\n3 2 4\n6', expectedOutput: '1 2', isHidden: true, marks: 12 }
    ]
  },
  {
    id: '22222222-2222-4222-8222-222222222002',
    title: 'Valid Parentheses',
    description: 'Check whether a string of brackets is valid.',
    inputFormat: 'A single string containing only ()[]{} characters.',
    outputFormat: 'true or false',
    sampleInput: '()[]{}',
    sampleOutput: 'true',
    marks: 20,
    timeLimit: 2000,
    memoryLimit: 256,
    supportedLanguages: ['python', 'javascript', 'java', 'cpp'],
    partialScoring: false,
    autoEvaluate: true,
    difficulty: 'easy',
    topic: 'Stacks',
    tags: ['stack', 'strings'],
    testCases: [
      { input: '()[]{}', expectedOutput: 'true', marks: 8 },
      { input: '(]', expectedOutput: 'false', isHidden: true, marks: 12 }
    ]
  },
  {
    id: '22222222-2222-4222-8222-222222222003',
    title: 'Longest Substring Without Repeating Characters',
    description: 'Return the length of the longest substring without repeating characters.',
    inputFormat: 'A single string s.',
    outputFormat: 'An integer length.',
    sampleInput: 'abcabcbb',
    sampleOutput: '3',
    marks: 25,
    timeLimit: 2500,
    memoryLimit: 256,
    supportedLanguages: ['python', 'javascript', 'java', 'cpp'],
    partialScoring: true,
    autoEvaluate: true,
    difficulty: 'medium',
    topic: 'Sliding Window',
    tags: ['sliding-window', 'strings'],
    testCases: [
      { input: 'abcabcbb', expectedOutput: '3', marks: 10 },
      { input: 'bbbbb', expectedOutput: '1', isHidden: true, marks: 7 },
      { input: 'pwwkew', expectedOutput: '3', isHidden: true, marks: 8 }
    ]
  },
  {
    id: '22222222-2222-4222-8222-222222222004',
    title: 'Merge Intervals',
    description: 'Given a list of intervals, merge all overlapping intervals.',
    inputFormat: 'First line: n. Next n lines: start end.',
    outputFormat: 'Merged intervals each on a new line.',
    sampleInput: '4\n1 3\n2 6\n8 10\n15 18',
    sampleOutput: '1 6\n8 10\n15 18',
    marks: 25,
    timeLimit: 2500,
    memoryLimit: 256,
    supportedLanguages: ['python', 'javascript', 'java', 'cpp'],
    partialScoring: true,
    autoEvaluate: true,
    difficulty: 'medium',
    topic: 'Intervals',
    tags: ['sorting', 'intervals'],
    testCases: [
      { input: '4\n1 3\n2 6\n8 10\n15 18', expectedOutput: '1 6\n8 10\n15 18', marks: 10 },
      { input: '2\n1 4\n4 5', expectedOutput: '1 5', isHidden: true, marks: 15 }
    ]
  },
  {
    id: '22222222-2222-4222-8222-222222222005',
    title: 'Top K Frequent Elements',
    description: 'Return k most frequent elements from an integer array.',
    inputFormat: 'First line: n. Second line: n integers. Third line: k.',
    outputFormat: 'k elements in any order.',
    sampleInput: '6\n1 1 1 2 2 3\n2',
    sampleOutput: '1 2',
    marks: 30,
    timeLimit: 2500,
    memoryLimit: 256,
    supportedLanguages: ['python', 'javascript', 'java', 'cpp'],
    partialScoring: true,
    autoEvaluate: true,
    difficulty: 'medium',
    topic: 'Heaps',
    tags: ['heap', 'frequency-map'],
    testCases: [
      { input: '6\n1 1 1 2 2 3\n2', expectedOutput: '1 2', marks: 12 },
      { input: '1\n1\n1', expectedOutput: '1', isHidden: true, marks: 8 },
      { input: '5\n4 4 4 6 6\n1', expectedOutput: '4', isHidden: true, marks: 10 }
    ]
  },
  {
    id: '22222222-2222-4222-8222-222222222006',
    title: 'Binary Tree Level Order Traversal',
    description: 'Return level-order traversal values of a binary tree.',
    inputFormat: 'Array representation using null for missing nodes.',
    outputFormat: 'Each level on a new line as space-separated integers.',
    sampleInput: '3 9 20 null null 15 7',
    sampleOutput: '3\n9 20\n15 7',
    marks: 30,
    timeLimit: 3000,
    memoryLimit: 256,
    supportedLanguages: ['python', 'javascript', 'java', 'cpp'],
    partialScoring: true,
    autoEvaluate: true,
    difficulty: 'medium',
    topic: 'Trees',
    tags: ['bfs', 'binary-tree'],
    testCases: [
      { input: '3 9 20 null null 15 7', expectedOutput: '3\n9 20\n15 7', marks: 15 },
      { input: '1', expectedOutput: '1', isHidden: true, marks: 15 }
    ]
  },
  {
    id: '22222222-2222-4222-8222-222222222007',
    title: 'Detect Cycle in Directed Graph',
    description: 'Given a directed graph, detect if it contains a cycle.',
    inputFormat: 'First line: n m. Next m lines: u v edge.',
    outputFormat: 'true or false',
    sampleInput: '3 3\n0 1\n1 2\n2 0',
    sampleOutput: 'true',
    marks: 35,
    timeLimit: 3000,
    memoryLimit: 256,
    supportedLanguages: ['python', 'javascript', 'java', 'cpp'],
    partialScoring: true,
    autoEvaluate: true,
    difficulty: 'hard',
    topic: 'Graphs',
    tags: ['dfs', 'graph-cycle'],
    testCases: [
      { input: '3 3\n0 1\n1 2\n2 0', expectedOutput: 'true', marks: 15 },
      { input: '4 3\n0 1\n1 2\n2 3', expectedOutput: 'false', isHidden: true, marks: 20 }
    ]
  },
  {
    id: '22222222-2222-4222-8222-222222222008',
    title: 'LRU Cache Design',
    description: 'Implement an LRU cache with get and put operations in O(1).',
    inputFormat: 'Sequence of operations with keys/values.',
    outputFormat: 'Outputs of get operations in order.',
    sampleInput: 'capacity=2; put(1,1); put(2,2); get(1); put(3,3); get(2)',
    sampleOutput: '1 -1',
    marks: 40,
    timeLimit: 3500,
    memoryLimit: 256,
    supportedLanguages: ['python', 'javascript', 'java', 'cpp'],
    partialScoring: true,
    autoEvaluate: true,
    difficulty: 'hard',
    topic: 'System Design',
    tags: ['lru', 'hashmap', 'doubly-linked-list'],
    testCases: [
      {
        input: 'capacity=2; put(1,1); put(2,2); get(1); put(3,3); get(2)',
        expectedOutput: '1 -1',
        marks: 18
      },
      {
        input: 'capacity=1; put(1,1); put(2,2); get(1); get(2)',
        expectedOutput: '-1 2',
        isHidden: true,
        marks: 22
      }
    ]
  },
  {
    id: '22222222-2222-4222-8222-222222222009',
    title: 'Kth Smallest in BST',
    description: 'Find the kth smallest element in a binary search tree.',
    inputFormat: 'BST nodes and integer k.',
    outputFormat: 'Single integer result.',
    sampleInput: '5 3 6 2 4 null null 1; k=3',
    sampleOutput: '3',
    marks: 25,
    timeLimit: 2500,
    memoryLimit: 256,
    supportedLanguages: ['python', 'javascript', 'java', 'cpp'],
    partialScoring: true,
    autoEvaluate: true,
    difficulty: 'medium',
    topic: 'Trees',
    tags: ['bst', 'inorder-traversal'],
    testCases: [
      { input: '5 3 6 2 4 null null 1; k=3', expectedOutput: '3', marks: 10 },
      { input: '3 1 4 null 2; k=1', expectedOutput: '1', isHidden: true, marks: 15 }
    ]
  },
  {
    id: '22222222-2222-4222-8222-222222222010',
    title: 'Minimum Window Substring',
    description: 'Find the minimum window in s containing all characters of t.',
    inputFormat: 'Two strings s and t.',
    outputFormat: 'Minimum window substring; empty string if impossible.',
    sampleInput: 'ADOBECODEBANC\nABC',
    sampleOutput: 'BANC',
    marks: 40,
    timeLimit: 3500,
    memoryLimit: 256,
    supportedLanguages: ['python', 'javascript', 'java', 'cpp'],
    partialScoring: true,
    autoEvaluate: true,
    difficulty: 'hard',
    topic: 'Sliding Window',
    tags: ['sliding-window', 'hashmap'],
    testCases: [
      { input: 'ADOBECODEBANC\nABC', expectedOutput: 'BANC', marks: 18 },
      { input: 'a\naa', expectedOutput: '', isHidden: true, marks: 22 }
    ]
  }
];

const behavioralQuestions: BehavioralSeed[] = [
  {
    id: '33333333-3333-4333-8333-333333333001',
    title: 'Handling Production Incident',
    description: 'Describe a time you handled a high-severity production issue. How did you respond?',
    expectedAnswer: 'Shows calm triage, communication, prioritization, and post-incident learning.',
    marks: 10,
    difficulty: 'medium',
    topic: 'Incident Management',
    tags: ['ownership', 'communication']
  },
  {
    id: '33333333-3333-4333-8333-333333333002',
    title: 'Disagreement With Team Member',
    description: 'Tell us about a technical disagreement and how you resolved it constructively.',
    expectedAnswer: 'Mentions evidence-based discussion, respectful dialogue, and alignment on outcomes.',
    marks: 10,
    difficulty: 'easy',
    topic: 'Collaboration',
    tags: ['conflict-resolution', 'teamwork']
  },
  {
    id: '33333333-3333-4333-8333-333333333003',
    title: 'Learning a New Technology Quickly',
    description: 'Explain how you ramped up on an unfamiliar technology under time pressure.',
    expectedAnswer: 'Structured learning plan, quick experimentation, and measurable delivery.',
    marks: 10,
    difficulty: 'easy',
    topic: 'Adaptability',
    tags: ['learning', 'execution']
  },
  {
    id: '33333333-3333-4333-8333-333333333004',
    title: 'Prioritizing Competing Deadlines',
    description: 'How do you prioritize when multiple critical tasks arrive simultaneously?',
    expectedAnswer: 'Evaluates impact/urgency, aligns with stakeholders, and communicates trade-offs.',
    marks: 10,
    difficulty: 'medium',
    topic: 'Prioritization',
    tags: ['time-management', 'decision-making']
  },
  {
    id: '33333333-3333-4333-8333-333333333005',
    title: 'Giving and Receiving Feedback',
    description: 'Share an example of giving difficult feedback or receiving it and acting on it.',
    expectedAnswer: 'Demonstrates empathy, specificity, growth mindset, and follow-through.',
    marks: 10,
    difficulty: 'easy',
    topic: 'Professionalism',
    tags: ['feedback', 'growth']
  },
  {
    id: '33333333-3333-4333-8333-333333333006',
    title: 'Ethical Decision Under Pressure',
    description: 'You discover a release might expose user data but deadline is near. What do you do?',
    expectedAnswer: 'Prioritizes user safety/compliance, escalates risk, and proposes safe alternatives.',
    marks: 15,
    difficulty: 'hard',
    topic: 'Ethics',
    tags: ['security', 'integrity']
  },
  {
    id: '33333333-3333-4333-8333-333333333007',
    title: 'Mentoring a Junior Engineer',
    description: 'Describe how you helped a junior engineer improve code quality and confidence.',
    expectedAnswer: 'Coaching approach, concrete guidance, regular check-ins, and measurable improvement.',
    marks: 10,
    difficulty: 'medium',
    topic: 'Leadership',
    tags: ['mentoring', 'leadership']
  },
  {
    id: '33333333-3333-4333-8333-333333333008',
    title: 'Ambiguous Requirements',
    description: 'How do you proceed when product requirements are vague or contradictory?',
    expectedAnswer: 'Clarifies assumptions, asks targeted questions, drafts proposals, and validates iteratively.',
    marks: 10,
    difficulty: 'medium',
    topic: 'Requirement Analysis',
    tags: ['clarification', 'stakeholder-management']
  },
  {
    id: '33333333-3333-4333-8333-333333333009',
    title: 'Balancing Quality and Speed',
    description: 'When delivery pressure is high, how do you maintain quality without blocking momentum?',
    expectedAnswer: 'Uses risk-based testing, incremental delivery, and explicit technical debt tracking.',
    marks: 15,
    difficulty: 'hard',
    topic: 'Engineering Excellence',
    tags: ['quality', 'delivery']
  },
  {
    id: '33333333-3333-4333-8333-333333333010',
    title: 'Ownership Without Authority',
    description: 'Give an example where you drove a cross-team effort without direct reporting authority.',
    expectedAnswer: 'Shows influence through clarity, alignment, proactive follow-up, and accountability.',
    marks: 15,
    difficulty: 'hard',
    topic: 'Cross-functional Collaboration',
    tags: ['ownership', 'influence']
  }
];

function jsonArray(values: string[] | number[]): string {
  return JSON.stringify(values);
}

async function seedMCQBank(): Promise<void> {
  for (const question of mcqQuestions) {
    await prisma.mCQQuestion.upsert({
      where: { id: question.id },
      create: {
        id: question.id,
        source: QuestionSource.QUESTION_BANK,
        repositoryCategory: QuestionRepositoryCategory.MCQ,
        isEnabled: true,
        questionText: question.questionText,
        options: jsonArray(question.options),
        correctAnswers: jsonArray(question.correctAnswers),
        marks: question.marks,
        isMultipleChoice: question.isMultipleChoice,
        explanation: question.explanation ?? null,
        difficulty: question.difficulty,
        topic: question.topic,
        tags: jsonArray(question.tags)
      },
      update: {
        source: QuestionSource.QUESTION_BANK,
        repositoryCategory: QuestionRepositoryCategory.MCQ,
        isEnabled: true,
        questionText: question.questionText,
        options: jsonArray(question.options),
        correctAnswers: jsonArray(question.correctAnswers),
        marks: question.marks,
        isMultipleChoice: question.isMultipleChoice,
        explanation: question.explanation ?? null,
        difficulty: question.difficulty,
        topic: question.topic,
        tags: jsonArray(question.tags)
      }
    });
  }
}

async function seedCodingBank(): Promise<void> {
  for (const question of codingQuestions) {
    await prisma.codingQuestion.upsert({
      where: { id: question.id },
      create: {
        id: question.id,
        source: QuestionSource.QUESTION_BANK,
        repositoryCategory: QuestionRepositoryCategory.CODING,
        isEnabled: true,
        title: question.title,
        description: question.description,
        inputFormat: question.inputFormat,
        outputFormat: question.outputFormat,
        constraints: question.constraints ?? null,
        sampleInput: question.sampleInput,
        sampleOutput: question.sampleOutput,
        marks: question.marks,
        timeLimit: question.timeLimit,
        memoryLimit: question.memoryLimit,
        supportedLanguages: jsonArray(question.supportedLanguages),
        partialScoring: question.partialScoring,
        autoEvaluate: question.autoEvaluate,
        difficulty: question.difficulty,
        topic: question.topic,
        tags: jsonArray(question.tags)
      },
      update: {
        source: QuestionSource.QUESTION_BANK,
        repositoryCategory: QuestionRepositoryCategory.CODING,
        isEnabled: true,
        title: question.title,
        description: question.description,
        inputFormat: question.inputFormat,
        outputFormat: question.outputFormat,
        constraints: question.constraints ?? null,
        sampleInput: question.sampleInput,
        sampleOutput: question.sampleOutput,
        marks: question.marks,
        timeLimit: question.timeLimit,
        memoryLimit: question.memoryLimit,
        supportedLanguages: jsonArray(question.supportedLanguages),
        partialScoring: question.partialScoring,
        autoEvaluate: question.autoEvaluate,
        difficulty: question.difficulty,
        topic: question.topic,
        tags: jsonArray(question.tags)
      }
    });

    await prisma.testCase.deleteMany({ where: { questionId: question.id } });
    await prisma.testCase.createMany({
      data: question.testCases.map((testCase) => ({
        questionId: question.id,
        input: testCase.input,
        expectedOutput: testCase.expectedOutput,
        isHidden: testCase.isHidden ?? false,
        marks: testCase.marks
      }))
    });
  }
}

async function seedBehavioralBank(): Promise<void> {
  for (const question of behavioralQuestions) {
    await prisma.behavioralQuestion.upsert({
      where: { id: question.id },
      create: {
        id: question.id,
        source: QuestionSource.QUESTION_BANK,
        repositoryCategory: QuestionRepositoryCategory.BEHAVIORAL,
        isEnabled: true,
        title: question.title,
        description: question.description,
        expectedAnswer: question.expectedAnswer,
        marks: question.marks,
        difficulty: question.difficulty,
        topic: question.topic,
        tags: jsonArray(question.tags)
      },
      update: {
        source: QuestionSource.QUESTION_BANK,
        repositoryCategory: QuestionRepositoryCategory.BEHAVIORAL,
        isEnabled: true,
        title: question.title,
        description: question.description,
        expectedAnswer: question.expectedAnswer,
        marks: question.marks,
        difficulty: question.difficulty,
        topic: question.topic,
        tags: jsonArray(question.tags)
      }
    });
  }
}

async function main(): Promise<void> {
  console.log('Seeding Library (10 each for MCQ, Coding, Behavioral)...');

  await seedMCQBank();
  await seedCodingBank();
  await seedBehavioralBank();

  console.log(`Question bank seeded successfully:
- MCQ: ${mcqQuestions.length}
- Coding: ${codingQuestions.length}
- Behavioral: ${behavioralQuestions.length}`);
}

main()
  .catch((error) => {
    console.error('Question bank seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
