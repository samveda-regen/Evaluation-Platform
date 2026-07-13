import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { generateCandidateToken } from '../utils/jwt.js';
import { AuthenticatedRequest } from '../types/index.js';
import { sanitizeInput } from '../utils/sanitize.js';
import { executeCodeWithRetry } from '../utils/codeExecutor.js';
import prisma from '../utils/db.js';
import { emitToAdminRoom, emitToTestProctorRoom, emitToProctorTargets } from '../services/socketService.js';
import { Prisma } from '@prisma/client';
import {
  InvitationServiceError,
  consumeInvitation,
  getInvitationContextForLogin,
  resolveInvitationTokenFromAccessCode
} from '../services/invitationService.js';
import { uploadSnapshot } from '../services/fileStorageService.js';
import { parseStoredCustomAIViolationEvents } from '../utils/proctoringConfig.js';
import { saveNotification, ensureNotificationTable } from './notifications.js';
import { testGradingQueue } from '../queues/testGradingQueue.js';

export async function candidateLogin(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { email, name, password } = req.body;
    const rawMode = typeof req.body.mode === 'string'
      ? sanitizeInput(req.body.mode).toLowerCase()
      : 'auto';
    const authMode = rawMode === 'signup' || rawMode === 'login' ? rawMode : 'auto';
    const invitationToken = typeof req.body.invitationToken === 'string'
      ? sanitizeInput(req.body.invitationToken).trim()
      : '';
    const testCode = typeof req.body.testCode === 'string'
      ? sanitizeInput(req.body.testCode).trim().toUpperCase()
      : '';

    if (typeof email !== 'string' || email.trim().length === 0) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const rawPassword = typeof password === 'string' ? password : '';
    const allowPasswordlessInvitationLogin = authMode === 'auto' && invitationToken.length > 0;

    if (!allowPasswordlessInvitationLogin && rawPassword.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    const sanitizedEmail = sanitizeInput(email).toLowerCase();
    const sanitizedName = typeof name === 'string' ? sanitizeInput(name).trim() : '';
    const now = new Date();

    if (authMode === 'signup' && sanitizedName.length < 2) {
      res.status(400).json({ error: 'Name is required for sign up' });
      return;
    }

    if (authMode === 'signup' && !invitationToken && !testCode) {
      res.status(400).json({ error: 'Provide a test code or invitation link to sign up for a test' });
      return;
    }

    let test = null;
    let invitationId: string | undefined;

    if (invitationToken) {
      const invitationDetails = await getInvitationContextForLogin(invitationToken);
      invitationId = invitationDetails.invitation.id;

      if (invitationDetails.invitation.email.toLowerCase() !== sanitizedEmail) {
        res.status(400).json({ error: 'This invitation link is assigned to a different email address' });
        return;
      }

      test = await prisma.test.findUnique({
        where: { id: invitationDetails.test.id }
      });

      if (!test) {
        res.status(404).json({ error: 'Test not found for this invitation' });
        return;
      }
    } else if (testCode) {
      test = await prisma.test.findUnique({
        where: { testCode }
      });

      if (!test) {
        res.status(404).json({ error: 'Invalid test code' });
        return;
      }
    }

    if (test) {
      // Check if test is active
      if (!test.isActive) {
        res.status(400).json({ error: 'This test is not currently available' });
        return;
      }

      // Check test time window
      if (now < test.startTime) {
        res.status(400).json({ error: 'This test has not started yet' });
        return;
      }

      if (test.endTime && now > test.endTime) {
        res.status(400).json({ error: 'This test has ended' });
        return;
      }
    }

    // Find candidate account
    let candidate = await prisma.candidate.findUnique({
      where: { email: sanitizedEmail }
    });

    let createdCandidate = false;
    if (authMode === 'signup') {
      if (sanitizedName.length < 2) {
        res.status(400).json({ error: 'Name is required for sign up' });
        return;
      }

      const hashedPassword = await bcrypt.hash(rawPassword, 12);

      if (candidate?.password) {
        res.status(409).json({ error: 'Account already exists. Please log in instead' });
        return;
      }

      if (candidate && !candidate.password) {
        candidate = await prisma.candidate.update({
          where: { id: candidate.id },
          data: {
            name: sanitizedName,
            password: hashedPassword
          }
        });
      } else {
        candidate = await prisma.candidate.create({
          data: {
            email: sanitizedEmail,
            name: sanitizedName,
            password: hashedPassword
          }
        });
        createdCandidate = true;
      }
    } else {
      if (!candidate && invitationId && authMode === 'auto') {
        candidate = await prisma.candidate.create({
          data: {
            email: sanitizedEmail,
            name: sanitizedName.length >= 2 ? sanitizedName : sanitizedEmail
          }
        });
        createdCandidate = true;
      }

      if (!candidate) {
        res.status(404).json({ error: 'Candidate account not found. Please sign up first' });
        return;
      }

      const skipPasswordCheck = authMode === 'auto' && !!invitationId;
      if (!skipPasswordCheck) {
        if (!candidate.password) {
          res.status(400).json({ error: 'Password not set for this account. Please use sign up to set one' });
          return;
        }

        const passwordMatches = await bcrypt.compare(rawPassword, candidate.password);
        if (!passwordMatches) {
          res.status(401).json({ error: 'Invalid email or password' });
          return;
        }
      }
    }

    if (!candidate) {
      res.status(500).json({ error: 'Unable to authenticate candidate account' });
      return;
    }

    if (!test) {
      const resumableAttempt = await prisma.testAttempt.findFirst({
        where: {
          candidateId: candidate.id,
          status: 'in_progress',
          test: {
            isActive: true,
            startTime: { lte: now },
            OR: [
              { endTime: null },
              { endTime: { gte: now } }
            ]
          }
        },
        orderBy: {
          startTime: 'desc'
        }
      });

      if (!resumableAttempt) {
        res.status(404).json({ error: 'No active in-progress test found for this account' });
        return;
      }

      const token = generateCandidateToken({
        id: candidate.id,
        email: candidate.email,
        testId: resumableAttempt.testId,
        attemptId: resumableAttempt.id,
        role: 'candidate'
      });

      await prisma.activityLog.create({
        data: {
          attemptId: resumableAttempt.id,
          eventType: 'login_resume',
          eventData: JSON.stringify({ timestamp: new Date().toISOString() })
        }
      });

      res.json({
        message: 'Resuming test session',
        candidate: {
          id: candidate.id,
          email: candidate.email,
          name: candidate.name
        },
        attempt: {
          id: resumableAttempt.id,
          startTime: resumableAttempt.startTime,
          status: resumableAttempt.status,
          violations: resumableAttempt.violations
        },
        token
      });
      return;
    }

    // Check for existing attempt (schema enforces one attempt row per test+candidate)
    const existingAttempt = await prisma.testAttempt.findUnique({
      where: {
        testId_candidateId: {
          testId: test.id,
          candidateId: candidate.id
        }
      }
    });

    if (existingAttempt) {
      if (existingAttempt.status === 'in_progress') {
        // Resume existing attempt
        const token = generateCandidateToken({
          id: candidate.id,
          email: candidate.email,
          testId: test.id,
          attemptId: existingAttempt.id,
          invitationId,
          role: 'candidate'
        });

        // Log login
        await prisma.activityLog.create({
          data: {
            attemptId: existingAttempt.id,
            eventType: 'login_resume',
            eventData: JSON.stringify({ timestamp: new Date().toISOString() })
          }
        });

        res.json({
          message: 'Resuming test session',
          candidate: {
            id: candidate.id,
            email: candidate.email,
            name: candidate.name
          },
          attempt: {
            id: existingAttempt.id,
            startTime: existingAttempt.startTime,
            status: existingAttempt.status,
            violations: existingAttempt.violations
          },
          token
        });
        return;
      }

      // Completed attempt exists
      if (!test.allowMultipleAttempts) {
        res.status(400).json({ error: 'You have already completed this test' });
        return;
      }

      // For allowMultipleAttempts, reset the same attempt row (schema has unique testId+candidateId).
      await prisma.$transaction([
        prisma.mCQAnswer.deleteMany({ where: { attemptId: existingAttempt.id } }),
        prisma.codingAnswer.deleteMany({ where: { attemptId: existingAttempt.id } }),
        prisma.activityLog.deleteMany({ where: { attemptId: existingAttempt.id } }),
        prisma.proctorSession.deleteMany({ where: { attemptId: existingAttempt.id } }),
        prisma.performanceAnalytics.deleteMany({ where: { attemptId: existingAttempt.id } }),
        prisma.testAttempt.update({
          where: { id: existingAttempt.id },
          data: {
            startTime: new Date(),
            endTime: null,
            submittedAt: null,
            status: 'in_progress',
            score: null,
            violations: 0,
            isFlagged: false,
            flagReason: null,
          },
        }),
      ]);

      const token = generateCandidateToken({
        id: candidate.id,
        email: candidate.email,
        testId: test.id,
        attemptId: existingAttempt.id,
        invitationId,
        role: 'candidate'
      });

      await prisma.activityLog.create({
        data: {
          attemptId: existingAttempt.id,
          eventType: 'login_new_attempt',
          eventData: JSON.stringify({ timestamp: new Date().toISOString() })
        }
      });

      res.json({
        message: 'New attempt started',
        candidate: {
          id: candidate.id,
          email: candidate.email,
          name: candidate.name
        },
        attempt: {
          id: existingAttempt.id,
          startTime: new Date(),
          status: 'in_progress',
          violations: 0
        },
        token
      });
      return;
    }

    // Create new attempt
    let attempt;
    try {
      attempt = await prisma.testAttempt.create({
        data: {
          testId: test.id,
          candidateId: candidate.id,
          startTime: new Date()
        }
      });
    } catch (error) {
      // Handle race condition where another request created the attempt concurrently.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrentAttempt = await prisma.testAttempt.findUnique({
          where: {
            testId_candidateId: {
              testId: test.id,
              candidateId: candidate.id
            }
          }
        });

        if (!concurrentAttempt) {
          throw error;
        }

        const token = generateCandidateToken({
          id: candidate.id,
          email: candidate.email,
          testId: test.id,
          attemptId: concurrentAttempt.id,
          invitationId,
          role: 'candidate'
        });

        await prisma.activityLog.create({
          data: {
            attemptId: concurrentAttempt.id,
            eventType: 'login_race_resume',
            eventData: JSON.stringify({ timestamp: new Date().toISOString() })
          }
        });

        res.json({
          message: 'Resuming test session',
          candidate: {
            id: candidate.id,
            email: candidate.email,
            name: candidate.name
          },
          attempt: {
            id: concurrentAttempt.id,
            startTime: concurrentAttempt.startTime,
            status: concurrentAttempt.status,
            violations: concurrentAttempt.violations
          },
          token
        });
        return;
      }
      throw error;
    }

    // Log login
    await prisma.activityLog.create({
      data: {
        attemptId: attempt.id,
        eventType: 'login',
        eventData: JSON.stringify({ timestamp: new Date().toISOString() })
      }
    });

    const token = generateCandidateToken({
      id: candidate.id,
      email: candidate.email,
      testId: test.id,
      attemptId: attempt.id,
      invitationId,
      role: 'candidate'
    });

    res.json({
      message: authMode === 'signup' ? 'Sign up successful' : createdCandidate ? 'Account created and logged in' : 'Login successful',
      candidate: {
        id: candidate.id,
        email: candidate.email,
        name: candidate.name
      },
      attempt: {
        id: attempt.id,
        startTime: attempt.startTime,
        status: attempt.status
      },
      token
    });
  } catch (error) {
    console.error('Candidate login error:', error);
    if (error instanceof Prisma.PrismaClientInitializationError) {
      res.status(503).json({ error: 'Database connection failed. Please verify PostgreSQL is running and DATABASE_URL is correct.' });
      return;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2021' || error.code === 'P2022') {
        res.status(500).json({ error: 'Database schema is out of date. Run Prisma schema sync/migrations and try again.' });
        return;
      }
    }

    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function candidateInvitationLogin(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    let rawToken = typeof req.body.token === 'string' ? req.body.token.trim() : '';

    if (!rawToken) {
      const rawAccessCode = typeof req.body.accessCode === 'string' ? req.body.accessCode.trim() : '';
      const rawEmail = typeof req.body.email === 'string' ? req.body.email.trim() : '';

      if (!rawAccessCode || !rawEmail) {
        res.status(400).json({ error: 'Access code and email are required' });
        return;
      }

      rawToken = await resolveInvitationTokenFromAccessCode(rawAccessCode, rawEmail);
    }

    const invitationDetails = await getInvitationContextForLogin(rawToken);

    req.body = {
      email: invitationDetails.invitation.email,
      name: invitationDetails.invitation.name,
      invitationToken: rawToken,
      mode: 'auto',
    };

    await candidateLogin(req, res);
  } catch (error) {
    if (error instanceof InvitationServiceError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    console.error('Candidate invitation login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getTestDetails(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId, attemptId } = req.candidate!;

    const [test, attempt] = await Promise.all([
      prisma.test.findUnique({
        where: { id: testId },
        select: {
          id: true,
          testCode: true,
          name: true,
          description: true,
          instructions: true,
          duration: true,
          startTime: true,
          endTime: true,
          totalMarks: true,
          passingMarks: true,
          negativeMarking: true,
          proctorEnabled: true,
          requireCamera: true,
          requireMicrophone: true,
          requireScreenShare: true,
          customAIViolations: true,
          shuffleQuestions: true,
          shuffleOptions: true,
          maxViolations: true
        }
      }),
      prisma.testAttempt.findUnique({
        where: { id: attemptId }
      })
    ]);

    if (!test || !attempt) {
      res.status(404).json({ error: 'Test or attempt not found' });
      return;
    }

    // Derive device requirements from proctoringSettings JSON when available.
    // This ensures the candidate "Before you begin" page always reflects what
    // the admin actually configured in the AI Proctoring tab, even if the
    // requireCamera/requireMicrophone/requireScreenShare fields are stale.
    let requireCamera = test.requireCamera;
    let requireMicrophone = test.requireMicrophone;
    let requireScreenShare = test.requireScreenShare;

    if (test.proctorEnabled) {
      try {
        const psRows = await prisma.$queryRaw<Array<{ proctoringSettings: string | null }>>`
          SELECT "proctoringSettings" FROM "Test" WHERE id = ${testId}
        `;
        if (psRows.length > 0 && psRows[0].proctoringSettings) {
          const ps = JSON.parse(psRows[0].proctoringSettings) as Record<string, unknown>;
          if (typeof ps.webcamOn === 'boolean') requireCamera = ps.webcamOn;
          if (typeof ps.micOn === 'boolean') requireMicrophone = ps.micOn;
          if (typeof ps.screenOn === 'boolean') requireScreenShare = ps.screenOn;
        }
      } catch { /* column not yet created — use DB fields as-is */ }
    }

    res.json({
      test: {
        ...test,
        requireCamera,
        requireMicrophone,
        requireScreenShare,
        customAIViolations: parseStoredCustomAIViolationEvents(test.customAIViolations),
      },
      attempt: {
        id: attempt.id,
        startTime: attempt.startTime,
        status: attempt.status,
        violations: attempt.violations
      }
    });
  } catch (error) {
    console.error('Get test details error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function startTest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { testId, attemptId, invitationId } = req.candidate!;

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: {
          select: {
            id: true,
            maxViolations: true,
            customAIViolations: true,
          },
        },
        candidate: { select: { name: true, email: true } },
      },
    });

    if (!attempt || attempt.status !== 'in_progress') {
      res.status(400).json({ error: 'Invalid attempt status' });
      return;
    }

    // Gate: if this test requires ID verification, the candidate must be verified by an admin
    const testConfig = await prisma.test.findUnique({
      where:  { id: testId },
      select: { requireIdVerification: true },
    });
    if (testConfig?.requireIdVerification) {
      const candidateId = req.candidate!.id;
      const identity = await prisma.candidateIdentity.findUnique({
        where:  { candidateId },
        select: { verificationStatus: true },
      });
      if (!identity || identity.verificationStatus !== 'verified') {
        res.status(403).json({ error: 'Identity verification must be approved by an admin before you can start this test.' });
        return;
      }
    }

    if (invitationId) {
      try {
        await consumeInvitation(invitationId, testId);
      } catch (error) {
        if (error instanceof InvitationServiceError) {
          res.status(error.statusCode).json({ error: error.message });
          return;
        }

        throw error;
      }
    }

    // Log test start
    await prisma.activityLog.create({
      data: {
        attemptId,
        eventType: 'test_start',
        eventData: JSON.stringify({ timestamp: new Date().toISOString() })
      }
    });

    // Get test questions
    const test = await prisma.test.findUnique({
      where: { id: testId },
      include: {
        questions: {
          include: {
            mcqQuestion: {
              include: {
                mediaAssets: true
              }
            },
            codingQuestion: {
              include: {
                testCases: {
                  where: { isHidden: false }
                }
              }
            },
            behavioralQuestion: true
          },
          orderBy: { orderIndex: 'asc' }
        },
        sections: {
          include: {
            questions: {
              include: {
                mcqQuestion: {
                  include: {
                    mediaAssets: true
                  }
                },
                codingQuestion: {
                  include: {
                    testCases: {
                      where: { isHidden: false }
                    }
                  }
                },
                behavioralQuestion: true
              },
              orderBy: { orderIndex: 'asc' }
            }
          },
          orderBy: { orderIndex: 'asc' }
        }
      }
    });

    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const attemptQuestions = await prisma.testAttemptQuestion.findMany({
      where: { attemptId },
      include: {
        testQuestion: {
          include: {
            mcqQuestion: {
              include: {
                mediaAssets: true
              }
            },
            codingQuestion: {
              include: {
                testCases: {
                  where: { isHidden: false }
                }
              }
            },
            behavioralQuestion: true
          }
        }
      },
      orderBy: { orderIndex: 'asc' }
    });

    const shuffleArray = <T>(items: T[]) => {
      const array = [...items];
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    };

    let selectedTestQuestions: typeof test.questions = attemptQuestions.length > 0
      ? attemptQuestions.map((item) => item.testQuestion)
      : [];

    if (selectedTestQuestions.length === 0) {
      const baseQuestions = test.questions.filter((q) => !q.sectionId);
      const sectionQuestions = (test.sections || []).flatMap((section) => section.questions || []);

      selectedTestQuestions = [...baseQuestions, ...sectionQuestions];

      if (test.shuffleQuestions) {
        selectedTestQuestions = shuffleArray(selectedTestQuestions);
      } else {
        selectedTestQuestions.sort((a, b) => a.orderIndex - b.orderIndex);
      }

      if (selectedTestQuestions.length > 0) {
        await prisma.testAttemptQuestion.createMany({
          data: selectedTestQuestions.map((question: { id: string }, index: number) => ({
            attemptId,
            testQuestionId: question.id,
            orderIndex: index
          }))
        });
      }
    }
    const normalizeMediaUrl = (rawUrl: string | null | undefined, storageKey: string | null | undefined): string => {
      const key = (storageKey || '').trim();
      let url = (rawUrl || '').trim();

      // Convert absolute URLs that point to files endpoint into same-origin relative URLs.
      const filesMarker = '/api/files/';
      if (url) {
        const markerIndex = url.indexOf(filesMarker);
        if (markerIndex >= 0) {
          const idPart = url.slice(markerIndex + filesMarker.length).split(/[?#]/)[0];
          if (idPart) {
            if (idPart.startsWith('path/')) {
              const keyPart = idPart.slice('path/'.length);
              return `/api/files/path/${keyPart}`;
            }
            return `/api/files/${idPart}`;
          }
        }
      }

      // If we have a storage key, serve through path endpoint.
      // This supports both:
      // - filesystem keys like "Question Bank/<qid>/file.jpg"
      // - db keys (file ids), since /path handler falls back to getFile(id)
      if (key) {
        return `/api/files/path/${encodeURIComponent(key)}`;
      }

      if (!url) return '';

      // Normalize '/files/...' to '/api/files/...'
      if (url.startsWith('/files/')) {
        return `/api${url}`;
      }

      return url;
    };

    // Format questions (remove correct answers for MCQ)
    let questions = selectedTestQuestions.map((q: typeof selectedTestQuestions[number]) => {
      if (q.questionType === 'mcq' && q.mcqQuestion) {
        const options = JSON.parse(q.mcqQuestion.options) as string[];
        // Include original index with each option to handle shuffling correctly
        const optionsWithIndex = options.map((text, index) => ({ originalIndex: index, text }));
        const mediaAssets = (q.mcqQuestion.mediaAssets || []).map((asset) => ({
          ...asset,
          storageUrl: normalizeMediaUrl(asset.storageUrl, asset.storageKey),
        }));

        return {
          id: q.id,
          type: 'mcq',
          questionId: q.mcqQuestion.id,
          questionText: q.mcqQuestion.questionText,
          options: optionsWithIndex,
          isMultipleChoice: q.mcqQuestion.isMultipleChoice,
          marks: q.mcqQuestion.marks,
          mediaAssets
        };
      } else if (q.questionType === 'coding' && q.codingQuestion) {
        return {
          id: q.id,
          type: 'coding',
          questionId: q.codingQuestion.id,
          title: q.codingQuestion.title,
          description: q.codingQuestion.description,
          inputFormat: q.codingQuestion.inputFormat,
          outputFormat: q.codingQuestion.outputFormat,
          constraints: q.codingQuestion.constraints,
          sampleInput: q.codingQuestion.sampleInput,
          sampleOutput: q.codingQuestion.sampleOutput,
          supportedLanguages: JSON.parse(q.codingQuestion.supportedLanguages),
          codeTemplates: q.codingQuestion.codeTemplates ? JSON.parse(q.codingQuestion.codeTemplates) : null,
          timeLimit: q.codingQuestion.timeLimit,
          marks: q.codingQuestion.marks,
          testCases: q.codingQuestion.testCases.map((tc: { input: string; expectedOutput: string }) => ({
            input: tc.input,
            expectedOutput: tc.expectedOutput
          }))
        };
      } else if (q.questionType === 'behavioral' && q.behavioralQuestion) {
        return {
          id: q.id,
          type: 'behavioral',
          questionId: q.behavioralQuestion.id,
          title: q.behavioralQuestion.title,
          description: q.behavioralQuestion.description,
          marks: q.behavioralQuestion.marks
        };
      }
      return null;
    }).filter(Boolean);

    if (test.shuffleOptions) {
      for (const q of questions) {
        if (q && q.type === 'mcq' && Array.isArray(q.options)) {
          // Shuffle options in place while preserving originalIndex
          q.options.sort(() => Math.random() - 0.5);
        }
      }
    }

    // Fetch proctoringSettings + violationPopupSettings from raw SQL columns
    let proctoringSettingsRawForStart: string | null = null;
    let violationPopupSettingsRaw: string | null = null;
    try {
      const rawRows = await prisma.$queryRaw<Array<{ proctoringSettings: string | null; violationPopupSettings: string | null }>>`
        SELECT "proctoringSettings", "violationPopupSettings" FROM "Test" WHERE id = ${testId}
      `;
      if (rawRows.length > 0) {
        proctoringSettingsRawForStart = rawRows[0].proctoringSettings;
        violationPopupSettingsRaw = rawRows[0].violationPopupSettings;
      }
    } catch { /* columns not yet created — safe to ignore */ }

    // Derive device requirements + test-behavior flags from proctoringSettings JSON (same as getTestDetails)
    let startRequireCamera = test.requireCamera;
    let startRequireMicrophone = test.requireMicrophone;
    let startRequireScreenShare = test.requireScreenShare;
    let startAllowBackNavigation = false;
    let startShowTimer = true;
    let startAutoSubmitOnTimeout = true;
    if (proctoringSettingsRawForStart) {
      try {
        const ps = JSON.parse(proctoringSettingsRawForStart) as Record<string, unknown>;
        if (test.proctorEnabled) {
          if (typeof ps.webcamOn === 'boolean') startRequireCamera = ps.webcamOn;
          if (typeof ps.micOn === 'boolean') startRequireMicrophone = ps.micOn;
          if (typeof ps.screenOn === 'boolean') startRequireScreenShare = ps.screenOn;
        }
        if (typeof ps.allowBackNavigation === 'boolean') startAllowBackNavigation = ps.allowBackNavigation;
        if (typeof ps.showTimer === 'boolean') startShowTimer = ps.showTimer;
        if (typeof ps.autoSubmitOnTimeout === 'boolean') startAutoSubmitOnTimeout = ps.autoSubmitOnTimeout;
      } catch { /* ignore malformed JSON */ }
    }

    res.json({
      test: {
        id: test.id,
        name: test.name,
        duration: test.duration,
        totalMarks: test.totalMarks,
        negativeMarking: test.negativeMarking,
        proctorEnabled: test.proctorEnabled,
        requireCamera: startRequireCamera,
        requireMicrophone: startRequireMicrophone,
        requireScreenShare: startRequireScreenShare,
        maxViolations: test.maxViolations,
        customAIViolations: parseStoredCustomAIViolationEvents(test.customAIViolations),
        violationPopupSettings: violationPopupSettingsRaw || undefined,
        allowBackNavigation: startAllowBackNavigation,
        showTimer: startShowTimer,
        autoSubmitOnTimeout: startAutoSubmitOnTimeout,
      },
      questions,
      startTime: attempt.startTime
    });

    // Notify admin that a candidate has started the exam
    emitToAdminRoom(test.adminId, 'test-started', {
      testId,
      testName: test.name,
      attemptId,
      candidateName: (attempt as any).candidate?.name ?? 'Unknown',
      candidateEmail: (attempt as any).candidate?.email ?? '',
      timestamp: new Date().toISOString(),
    });

    // Persist notification to DB
    void ensureNotificationTable().then(() =>
      saveNotification({
        adminId: test.adminId,
        type: 'started',
        attemptId,
        testId,
        testName: test.name,
        candidateName: (attempt as any).candidate?.name ?? 'Unknown',
        autoSubmit: false,
      })
    ).catch(err => console.error('Notification save error (start):', err));
  } catch (error) {
    console.error('Start test error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function saveMCQAnswer(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { attemptId } = req.candidate!;
    const { questionId, selectedOptions } = req.body;

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: {
          select: {
            id: true,
            maxViolations: true,
            customAIViolations: true,
          },
        },
      },
    });

    if (!attempt || attempt.status !== 'in_progress') {
      res.status(400).json({ error: 'Cannot save answer - test not in progress' });
      return;
    }

    // Upsert answer
    await prisma.mCQAnswer.upsert({
      where: {
        attemptId_questionId: {
          attemptId,
          questionId
        }
      },
      create: {
        attemptId,
        questionId,
        selectedOptions: JSON.stringify(selectedOptions)
      },
      update: {
        selectedOptions: JSON.stringify(selectedOptions),
        answeredAt: new Date()
      }
    });

    res.json({ message: 'Answer saved' });
  } catch (error) {
    console.error('Save MCQ answer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function saveCodingAnswer(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { attemptId } = req.candidate!;
    const { questionId, code, language } = req.body;

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: {
          select: {
            id: true,
            maxViolations: true,
            customAIViolations: true,
          },
        },
      },
    });

    if (!attempt || attempt.status !== 'in_progress') {
      res.status(400).json({ error: 'Cannot save answer - test not in progress' });
      return;
    }

    // Upsert answer
    await prisma.codingAnswer.upsert({
      where: {
        attemptId_questionId: {
          attemptId,
          questionId
        }
      },
      create: {
        attemptId,
        questionId,
        code,
        language
      },
      update: {
        code,
        language,
        submittedAt: new Date()
      }
    });

    res.json({ message: 'Code saved' });
  } catch (error) {
    console.error('Save coding answer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function saveBehavioralAnswer(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { attemptId } = req.candidate!;
    const { questionId, answerText } = req.body;

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId }
    });

    if (!attempt || attempt.status !== 'in_progress') {
      res.status(400).json({ error: 'Cannot save answer - test not in progress' });
      return;
    }

    await prisma.behavioralAnswer.upsert({
      where: {
        attemptId_questionId: {
          attemptId,
          questionId
        }
      },
      create: {
        attemptId,
        questionId,
        answerText: typeof answerText === 'string' ? answerText : ''
      },
      update: {
        answerText: typeof answerText === 'string' ? answerText : '',
        submittedAt: new Date()
      }
    });

    res.json({ message: 'Behavioral answer saved' });
  } catch (error) {
    console.error('Save behavioral answer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function runCode(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { attemptId } = req.candidate!;
    const { questionId, code, language, input } = req.body;

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId }
    });

    if (!attempt || attempt.status !== 'in_progress') {
      res.status(400).json({ error: 'Cannot run code - test not in progress' });
      return;
    }

    const question = await prisma.codingQuestion.findUnique({
      where: { id: questionId }
    });

    if (!question) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    const result = await executeCodeWithRetry({
      language,
      code,
      input: input || '',
      timeLimit: question.timeLimit
    });

    res.json({ result });
  } catch (error) {
    console.error('Run code error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function logActivity(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { attemptId, testId } = req.candidate!;
    const { eventType, eventData } = req.body;
    const normalizedEventType = typeof eventType === 'string' ? eventType.trim().toLowerCase() : '';
    const normalizedEventData = eventData && typeof eventData === 'object' ? eventData : null;

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: {
        test: {
          select: {
            id: true,
            maxViolations: true,
            customAIViolations: true,
          },
        },
      },
    });

    if (!attempt) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }

    await prisma.activityLog.create({
      data: {
        attemptId,
        eventType: normalizedEventType || 'unknown',
        eventData: normalizedEventData ? JSON.stringify(normalizedEventData) : null
      }
    });

    emitToTestProctorRoom(testId, 'activity-update', {
      testId,
        attemptId,
        activity: {
        eventType: normalizedEventType || 'unknown',
        eventData: normalizedEventData || null,
        timestamp: new Date().toISOString(),
      },
    });

    // Update violation count for certain events
    const violationEventMap: Record<string, string> = {
      // Canonical names (frontend sends these after normalizing)
      tab_switch: 'tab_switch',
      window_blur: 'window_blur',
      fullscreen_exit: 'fullscreen_exit',
      copy_paste_attempt: 'copy_paste_attempt',
      devtools_open: 'devtools_open',
      // Legacy aliases (pre-normalized names, kept for compatibility)
      focus_loss: 'window_blur',
      window_exit: 'window_blur',
      copy_attempt: 'copy_paste_attempt',
      paste_attempt: 'copy_paste_attempt',
      copy_paste: 'copy_paste_attempt',
    };
    const violationSeverityMap: Record<string, 'low' | 'medium' | 'high' | 'critical'> = {
      tab_switch: 'medium', // Warning
      window_blur: 'medium', // Warning
      fullscreen_exit: 'high', // Alert
      copy_paste_attempt: 'medium', // Warning
      devtools_open: 'critical',
    };
    if (violationEventMap[normalizedEventType]) {
      const mappedType = violationEventMap[normalizedEventType];
      const mappedSeverity = violationSeverityMap[mappedType] || 'medium';

      const enabledViolations = new Set(parseStoredCustomAIViolationEvents(attempt.test.customAIViolations));
      if (!enabledViolations.has(mappedType)) {
        res.json({
          message: 'Activity logged',
          ignored: true,
          reason: 'event_not_enabled_for_test',
          mappedEventType: mappedType,
        });
        return;
      }

      const updatedAttempt = await prisma.testAttempt.update({
        where: { id: attemptId },
        data: { violations: { increment: 1 } },
        select: { violations: true, testId: true },
      });
      const newViolations = updatedAttempt.violations;

      const session = await prisma.proctorSession.findUnique({
        where: { attemptId },
        select: { id: true },
      });

      if (session) {
        let snapshotUrl: string | undefined;
        const snapshotBase64 =
          typeof normalizedEventData?.snapshotData === 'string' ? normalizedEventData.snapshotData : undefined;
        const metadataForEvent = normalizedEventData
          ? Object.fromEntries(
              Object.entries(normalizedEventData).filter(([k]) => k !== 'snapshotData')
            )
          : null;
        if (snapshotBase64) {
          try {
            const buffer = Buffer.from(snapshotBase64, 'base64');
            const uploaded = await uploadSnapshot(buffer, attemptId, 'violation');
            if (uploaded.success) {
              snapshotUrl = uploaded.cdnUrl || uploaded.url;
            }
          } catch {
            snapshotUrl = undefined;
          }
        }
        if (!snapshotUrl) {
          const latestFaceSnapshot = await prisma.faceSnapshot.findFirst({
            where: { sessionId: session.id },
            orderBy: { capturedAt: 'desc' },
            select: { imageUrl: true },
          });
          if (latestFaceSnapshot?.imageUrl) {
            snapshotUrl = latestFaceSnapshot.imageUrl;
          }
        }
        await prisma.proctorEvent.create({
          data: {
            sessionId: session.id,
            eventType: mappedType,
            severity: mappedSeverity,
            confidence:
              typeof normalizedEventData?.confidence === 'number'
                ? normalizedEventData.confidence
                : 100,
            description:
              (normalizedEventData?.message as string | undefined) ||
              `${normalizedEventType.replace(/_/g, ' ')} detected`,
            metadata: metadataForEvent ? JSON.stringify(metadataForEvent) : null,
            snapshotUrl,
            duration:
              typeof normalizedEventData?.durationMs === 'number'
                ? Math.max(0, Math.floor(normalizedEventData.durationMs))
                : null,
          },
        });
      }

      emitToProctorTargets(testId, attemptId, 'violation-detected', {
        testId,
        attemptId,
        violation: {
          type: mappedType,
          severity: mappedSeverity,
          description:
            (normalizedEventData?.message as string | undefined) ||
            `${normalizedEventType.replace(/_/g, ' ')} detected`,
          timestamp: new Date().toISOString(),
        },
      });

      const maxViolations = attempt.test.maxViolations;
      if (newViolations >= maxViolations) {
        res.json({
          message: 'Activity logged',
          violation: true,
          violationCount: newViolations,
          autoSubmit: true
        });
        return;
      }

      res.json({
        message: 'Activity logged',
        violation: true,
        violationCount: newViolations,
        maxViolations
      });
      return;
    }

    res.json({ message: 'Activity logged' });
  } catch (error) {
    console.error('Log activity error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function submitTest(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { attemptId, testId } = req.candidate!;
    const { autoSubmit } = req.body;

    const [attempt, test] = await Promise.all([
      prisma.testAttempt.findUnique({ where: { id: attemptId }, select: { status: true } }),
      prisma.test.findUnique({ where: { id: testId }, select: { totalMarks: true } }),
    ]);

    if (!attempt) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }

    if (attempt.status !== 'in_progress') {
      res.status(400).json({ error: 'Test already submitted' });
      return;
    }

    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const attemptStatus = autoSubmit ? 'auto_submitted' : 'submitted';

    // Mark the attempt submitted and respond immediately. Actual grading
    // (MCQ scoring plus running every coding answer against its test cases —
    // which used to block this response for as long as code execution took)
    // now happens asynchronously via the test-grading worker. `score` stays
    // null until that job finishes; results.ts/analytics.ts already treat a
    // null score as "not yet scored".
    await prisma.testAttempt.update({
      where: { id: attemptId },
      data: {
        status: attemptStatus,
        endTime: new Date(),
        submittedAt: new Date(),
      },
    });

    await prisma.activityLog.create({
      data: {
        attemptId,
        eventType: autoSubmit ? 'auto_submit' : 'manual_submit',
        eventData: JSON.stringify({ timestamp: new Date().toISOString() }),
      },
    });

    // Enqueue before responding so a crash between these two lines can't
    // leave the attempt stuck "submitted" with no grading job ever created.
    await testGradingQueue.add('grade', { attemptId, testId, autoSubmit: !!autoSubmit });

    res.json({
      message: 'Test submitted successfully',
      totalMarks: test.totalMarks,
      resultReleased: false,
      gradingInProgress: true,
    });
  } catch (error) {
    console.error('Submit test error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getSavedAnswers(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { attemptId } = req.candidate!;

    const [mcqAnswers, codingAnswers, behavioralAnswers] = await Promise.all([
      prisma.mCQAnswer.findMany({
        where: { attemptId },
        select: {
          questionId: true,
          selectedOptions: true
        }
      }),
      prisma.codingAnswer.findMany({
        where: { attemptId },
        select: {
          questionId: true,
          code: true,
          language: true
        }
      }),
      prisma.behavioralAnswer.findMany({
        where: { attemptId },
        select: {
          questionId: true,
          answerText: true
        }
      })
    ]);

    res.json({
      mcqAnswers: mcqAnswers.map((a: { questionId: string; selectedOptions: string }) => ({
        questionId: a.questionId,
        selectedOptions: JSON.parse(a.selectedOptions)
      })),
      codingAnswers,
      behavioralAnswers
    });
  } catch (error) {
    console.error('Get saved answers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
