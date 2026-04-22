import { body, param, query, ValidationChain, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';

export const handleValidationErrors = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

// Admin validation
export const adminLoginValidation: ValidationChain[] = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
];

export const adminRegisterValidation: ValidationChain[] = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters')
];

// Test validation
export const createTestValidation: ValidationChain[] = [
  body('name').trim().isLength({ min: 1 }).withMessage('Test name is required'),
  body('duration').isInt({ min: 1 }).withMessage('Duration must be a positive integer (minutes)'),
  body('startTime').isISO8601().withMessage('Valid start time is required'),
  body('endTime').optional({ values: 'null' }).isISO8601().withMessage('End time must be valid ISO8601'),
  body('totalMarks').isInt({ min: 1 }).withMessage('Total marks must be positive'),
  body('passingMarks').optional().isInt({ min: 0 }).withMessage('Passing marks must be non-negative'),
  body('negativeMarking').optional().isFloat({ min: 0 }).withMessage('Negative marking must be non-negative'),
  body('maxViolations').optional().isInt({ min: 1 }).withMessage('Max violations must be at least 1'),
  body('proctorEnabled').optional().isBoolean().withMessage('Proctor enabled must be boolean'),
  body('requireCamera').optional().isBoolean().withMessage('Require camera must be boolean'),
  body('requireMicrophone').optional().isBoolean().withMessage('Require microphone must be boolean'),
  body('requireScreenShare').optional().isBoolean().withMessage('Require screen share must be boolean'),
  body('requireIdVerification').optional().isBoolean().withMessage('Require ID verification must be boolean'),
  body('customAIViolations').optional().isArray().withMessage('customAIViolations must be an array'),
  body('customAIViolations.*').optional().isString().withMessage('Each customAIViolations value must be a string'),
  body('instructions').optional().trim()
];

export const updateTestValidation: ValidationChain[] = [
  param('testId').isUUID().withMessage('Valid test ID required'),
  body('name').optional().trim().isLength({ min: 1 }),
  body('duration').optional().isInt({ min: 1 }),
  body('startTime').optional().isISO8601(),
  body('endTime').optional({ values: 'null' }).isISO8601(),
  body('totalMarks').optional().isInt({ min: 1 }),
  body('passingMarks').optional().isInt({ min: 0 }),
  body('negativeMarking').optional().isFloat({ min: 0 }),
  body('maxViolations').optional().isInt({ min: 1 }),
  body('proctorEnabled').optional().isBoolean(),
  body('requireCamera').optional().isBoolean(),
  body('requireMicrophone').optional().isBoolean(),
  body('requireScreenShare').optional().isBoolean(),
  body('requireIdVerification').optional().isBoolean(),
  body('customAIViolations').optional().isArray(),
  body('customAIViolations.*').optional().isString()
];

// MCQ Question validation
export const createMCQValidation: ValidationChain[] = [
  body('questionText').trim().isLength({ min: 1 }).withMessage('Question text is required'),
  body('options').isArray({ min: 2, max: 6 }).withMessage('2-6 options required'),
  body('options.*').trim().isLength({ min: 1 }).withMessage('Each option must have text'),
  body('correctAnswers').isArray({ min: 1 }).withMessage('At least one correct answer required'),
  body('correctAnswers.*').isInt({ min: 0 }).withMessage('Correct answers must be valid indices'),
  body('marks').isInt({ min: 1 }).withMessage('Marks must be positive'),
  body('isMultipleChoice').optional().isBoolean()
];

// Coding Question validation
export const createCodingValidation: ValidationChain[] = [
  body('title').trim().isLength({ min: 1 }).withMessage('Title is required'),
  body('description').trim().isLength({ min: 1 }).withMessage('Description is required'),
  body('inputFormat').trim().isLength({ min: 1 }).withMessage('Input format is required'),
  body('outputFormat').trim().isLength({ min: 1 }).withMessage('Output format is required'),
  body('sampleInput').isString().withMessage('Sample input is required'),
  body('sampleOutput').isString().withMessage('Sample output is required'),
  body('marks').isInt({ min: 1 }).withMessage('Marks must be positive'),
  body('supportedLanguages').isArray({ min: 1 }).withMessage('At least one language required'),
  body('testCases').isArray({ min: 1 }).withMessage('At least one test case required'),
  body('testCases.*.input').isString().withMessage('Test case input required'),
  body('testCases.*.expectedOutput').isString().withMessage('Test case expected output required')
];

// Candidate validation
export const candidateLoginValidation: ValidationChain[] = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password')
    .isString()
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters'),
  body('invitationToken')
    .optional({ values: 'falsy' })
    .isString()
    .isLength({ min: 32 })
    .withMessage('Valid invitation token is required'),
  body('testCode')
    .optional({ values: 'falsy' })
    .isString()
    .isLength({ min: 4, max: 32 })
    .withMessage('Test code must be 4-32 characters'),
  body('mode')
    .optional()
    .isIn(['signup', 'login', 'auto'])
    .withMessage('Mode must be signup, login, or auto'),
  body('name')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 2 })
    .withMessage('Name must be at least 2 characters')
];

export const invitationLoginValidation: ValidationChain[] = [
  body('token')
    .isString()
    .isLength({ min: 32 })
    .withMessage('Valid invitation token is required')
];

// Answer submission validation
export const submitMCQAnswerValidation: ValidationChain[] = [
  body('questionId').isUUID().withMessage('Valid question ID required'),
  body('selectedOptions').isArray().withMessage('Selected options must be an array'),
  body('selectedOptions.*').isInt({ min: 0 }).withMessage('Invalid option index')
];

export const submitCodingAnswerValidation: ValidationChain[] = [
  body('questionId').isUUID().withMessage('Valid question ID required'),
  body('code').isString().isLength({ min: 1 }).withMessage('Code is required'),
  body('language').isString().isLength({ min: 1 }).withMessage('Language is required')
];

export const submitBehavioralAnswerValidation: ValidationChain[] = [
  body('questionId').isUUID().withMessage('Valid question ID required'),
  body('answerText').isString().withMessage('Answer text is required')
];

export const activityLogValidation: ValidationChain[] = [
  body('eventType').isString().isLength({ min: 1 }).withMessage('Event type is required'),
  body('eventData').optional().isObject()
];

// Query validation
export const paginationValidation: ValidationChain[] = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
];
