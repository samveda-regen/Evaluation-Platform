import { Router } from 'express';
import { adminAuth } from '../middleware/auth';
import {
  getAttemptAnalytics,
  getTestAnalytics,
  getPerformanceComparisonData,
  getDifficultyAnalysis,
  getTopicAnalysis,
  getSkillAnalysis,
  getLeaderboard,
  regenerateTestAnalytics,
  getDashboardStats,
} from '../controllers/analytics';

const router = Router();

// All analytics routes require admin authentication

// Dashboard summary statistics
router.get('/dashboard', adminAuth, getDashboardStats);

// Attempt-level analytics
router.get('/attempt/:attemptId', adminAuth, getAttemptAnalytics);

// Test-level analytics
router.get('/test/:testId', adminAuth, getTestAnalytics);

// Performance comparison across candidates
router.get('/test/:testId/comparison', adminAuth, getPerformanceComparisonData);

// Difficulty-based analysis
router.get('/test/:testId/difficulty', adminAuth, getDifficultyAnalysis);

// Topic-wise analysis
router.get('/test/:testId/topics', adminAuth, getTopicAnalysis);

// Skill-wise analysis
router.get('/test/:testId/skills', adminAuth, getSkillAnalysis);

// Leaderboard
router.get('/test/:testId/leaderboard', adminAuth, getLeaderboard);

// Regenerate analytics for all attempts
router.post('/test/:testId/regenerate', adminAuth, regenerateTestAnalytics);

export default router;
