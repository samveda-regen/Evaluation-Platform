import bcrypt from 'bcryptjs';
import prisma from './utils/db.js';

async function main() {
  console.log('Seeding database...');

  // Create admin user
  const hashedPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.admin.upsert({
    where: { email: 'admin@example.com' },
    update: {
      password: hashedPassword,
      name: 'Admin User'
    },
    create: {
      email: 'admin@example.com',
      password: hashedPassword,
      name: 'Admin User'
    }
  });
  console.log('Created admin:', admin.email);

  // Create sample MCQ questions
  const upsertMcqByText = async (data: {
    questionText: string;
    options: string;
    correctAnswers: string;
    marks: number;
    isMultipleChoice: boolean;
    explanation?: string;
  }) => {
    const existing = await prisma.mCQQuestion.findFirst({
      where: { questionText: data.questionText },
      orderBy: { createdAt: 'asc' }
    });

    if (existing) {
      return prisma.mCQQuestion.update({
        where: { id: existing.id },
        data
      });
    }

    return prisma.mCQQuestion.create({ data });
  };

  const mcq1 = await upsertMcqByText({
    questionText: 'What is the capital of France?',
    options: JSON.stringify(['London', 'Paris', 'Berlin', 'Madrid']),
    correctAnswers: JSON.stringify([1]),
    marks: 5,
    isMultipleChoice: false
  });

  const mcq2 = await upsertMcqByText({
    questionText: 'Which of the following are programming languages?',
    options: JSON.stringify(['Python', 'HTML', 'JavaScript', 'CSS']),
    correctAnswers: JSON.stringify([0, 2]),
    marks: 10,
    isMultipleChoice: true,
    explanation: 'Python and JavaScript are programming languages. HTML and CSS are markup/styling languages.'
  });

  const mcq3 = await upsertMcqByText({
    questionText: 'What is 2 + 2?',
    options: JSON.stringify(['3', '4', '5', '6']),
    correctAnswers: JSON.stringify([1]),
    marks: 5,
    isMultipleChoice: false
  });

  console.log('Created MCQ questions');

  // Create sample coding question
  const upsertCodingByTitle = async (data: {
    title: string;
    description: string;
    inputFormat: string;
    outputFormat: string;
    constraints: string;
    sampleInput: string;
    sampleOutput: string;
    marks: number;
    timeLimit: number;
    memoryLimit: number;
    supportedLanguages: string;
    partialScoring: boolean;
    testCases: Array<{ input: string; expectedOutput: string; isHidden: boolean; marks: number }>;
  }) => {
    const existing = await prisma.codingQuestion.findFirst({
      where: { title: data.title },
      orderBy: { createdAt: 'asc' }
    });

    if (existing) {
      await prisma.testCase.deleteMany({
        where: { questionId: existing.id }
      });

      return prisma.codingQuestion.update({
        where: { id: existing.id },
        data: {
          title: data.title,
          description: data.description,
          inputFormat: data.inputFormat,
          outputFormat: data.outputFormat,
          constraints: data.constraints,
          sampleInput: data.sampleInput,
          sampleOutput: data.sampleOutput,
          marks: data.marks,
          timeLimit: data.timeLimit,
          memoryLimit: data.memoryLimit,
          supportedLanguages: data.supportedLanguages,
          partialScoring: data.partialScoring,
          testCases: {
            create: data.testCases
          }
        }
      });
    }

    return prisma.codingQuestion.create({
      data: {
        title: data.title,
        description: data.description,
        inputFormat: data.inputFormat,
        outputFormat: data.outputFormat,
        constraints: data.constraints,
        sampleInput: data.sampleInput,
        sampleOutput: data.sampleOutput,
        marks: data.marks,
        timeLimit: data.timeLimit,
        memoryLimit: data.memoryLimit,
        supportedLanguages: data.supportedLanguages,
        partialScoring: data.partialScoring,
        testCases: {
          create: data.testCases
        }
      }
    });
  };

  const coding1 = await upsertCodingByTitle({
    title: 'Sum of Two Numbers',
    description: 'Write a program that reads two integers and prints their sum.',
    inputFormat: 'Two space-separated integers A and B',
    outputFormat: 'A single integer representing the sum of A and B',
    constraints: '1 <= A, B <= 1000',
    sampleInput: '5 3',
    sampleOutput: '8',
    marks: 20,
    timeLimit: 2000,
    memoryLimit: 256,
    supportedLanguages: JSON.stringify(['python', 'javascript', 'cpp', 'java']),
    partialScoring: false,
    testCases: [
      { input: '5 3', expectedOutput: '8', isHidden: false, marks: 5 },
      { input: '10 20', expectedOutput: '30', isHidden: true, marks: 5 },
      { input: '0 0', expectedOutput: '0', isHidden: true, marks: 5 },
      { input: '999 1', expectedOutput: '1000', isHidden: true, marks: 5 }
    ]
  });

  const coding2 = await upsertCodingByTitle({
    title: 'Factorial',
    description: 'Write a program that calculates the factorial of a given number N.',
    inputFormat: 'A single integer N',
    outputFormat: 'The factorial of N',
    constraints: '0 <= N <= 12',
    sampleInput: '5',
    sampleOutput: '120',
    marks: 30,
    timeLimit: 2000,
    memoryLimit: 256,
    supportedLanguages: JSON.stringify(['python', 'javascript', 'cpp', 'java']),
    partialScoring: true,
    testCases: [
      { input: '5', expectedOutput: '120', isHidden: false, marks: 10 },
      { input: '0', expectedOutput: '1', isHidden: true, marks: 10 },
      { input: '10', expectedOutput: '3628800', isHidden: true, marks: 10 }
    ]
  });

  console.log('Created coding questions');

  // Create sample test
  const testQuestions = [
    { questionType: 'mcq', mcqQuestionId: mcq1.id, orderIndex: 0 },
    { questionType: 'mcq', mcqQuestionId: mcq2.id, orderIndex: 1 },
    { questionType: 'mcq', mcqQuestionId: mcq3.id, orderIndex: 2 },
    { questionType: 'coding', codingQuestionId: coding1.id, orderIndex: 3 },
    { questionType: 'coding', codingQuestionId: coding2.id, orderIndex: 4 }
  ];

  const test = await prisma.test.upsert({
    where: { testCode: 'DEMO2024' },
    update: {
      name: 'Demo Test',
      description: 'This is a demo test to test the platform.',
      instructions: `
1. This test contains both MCQ and coding questions.
2. MCQ questions have single or multiple correct answers.
3. Coding questions must be solved in the supported languages.
4. Tab switching and other suspicious activities will be logged.
5. The test will auto-submit after the time limit.
      `.trim(),
      duration: 60,
      startTime: new Date(),
      endTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      totalMarks: 70,
      passingMarks: 35,
      negativeMarking: 1,
      isActive: true,
      shuffleQuestions: false,
      shuffleOptions: false,
      allowMultipleAttempts: true,
      maxViolations: 5,
      adminId: admin.id,
      questions: {
        deleteMany: {},
        create: testQuestions
      }
    },
    create: {
      testCode: 'DEMO2024',
      name: 'Demo Test',
      description: 'This is a demo test to test the platform.',
      instructions: `
1. This test contains both MCQ and coding questions.
2. MCQ questions have single or multiple correct answers.
3. Coding questions must be solved in the supported languages.
4. Tab switching and other suspicious activities will be logged.
5. The test will auto-submit after the time limit.
      `.trim(),
      duration: 60,
      startTime: new Date(),
      endTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      totalMarks: 70,
      passingMarks: 35,
      negativeMarking: 1,
      isActive: true,
      shuffleQuestions: false,
      shuffleOptions: false,
      allowMultipleAttempts: true,
      maxViolations: 5,
      adminId: admin.id,
      questions: {
        create: testQuestions
      }
    }
  });

  console.log('Created test:', test.testCode);
  console.log('\nSeeding complete!');
  console.log('\nDefault credentials:');
  console.log('  Admin: admin@example.com / admin123');
  console.log('  Demo Test Code: DEMO2024');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
