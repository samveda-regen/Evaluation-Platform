import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import fs from 'fs';
import path from 'path';

import adminRoutes from './routes/admin.js';
import candidateRoutes from './routes/candidate.js';
import proctoringRoutes from './routes/proctoring.js';
import mediaRoutes from './routes/media.js';
import verificationRoutes from './routes/verification.js';
import analyticsRoutes from './routes/analytics.js';
import filesRoutes from './routes/files.js';
import invitationRoutes from './routes/invitations.js';
import { setSocketServer } from './services/socketService.js';
import prisma from './utils/db.js';

function applyEnvFile(envPath: string): boolean {
  if (!fs.existsSync(envPath)) return false;

  const contents = fs.readFileSync(envPath, 'utf-8');
  const lines = contents.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const rawValue = trimmed.slice(eqIndex + 1).trim();
    let value = '';

    if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
      // Parse quoted values and allow trailing inline comments after closing quote.
      const quote = rawValue[0];
      for (let i = 1; i < rawValue.length; i += 1) {
        const ch = rawValue[i];
        if (ch === '\\' && i + 1 < rawValue.length) {
          value += rawValue[i + 1];
          i += 1;
          continue;
        }
        if (ch === quote) break;
        value += ch;
      }
    } else {
      // Support inline comments for unquoted values.
      const hashIndex = rawValue.indexOf('#');
      value = (hashIndex >= 0 ? rawValue.slice(0, hashIndex) : rawValue).trim();
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return true;
}

function loadEnvFile(): void {
  const candidatePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'backend', '.env'),
    path.resolve(__dirname, '..', '.env'),
  ];

  for (const envPath of candidatePaths) {
    if (applyEnvFile(envPath)) {
      console.info(`[env] loaded from ${envPath}`);
      return;
    }
  }

  console.warn('[env] .env file not found in expected locations');
}

loadEnvFile();

function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim();
  if (!trimmed) {
    return '';
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

function parseAllowedOrigins(raw: string | undefined): string[] {
  const defaults = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  const configured = (raw || '')
    .split(',')
    .map((value) => normalizeOrigin(value))
    .filter((value) => value.length > 0);

  return [...new Set([...defaults, ...configured])];
}

const allowedOrigins = parseAllowedOrigins(process.env.FRONTEND_URL);

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) {
    // Allow non-browser and same-origin requests without Origin header.
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);

  if (allowedOrigins.includes(normalizedOrigin)) {
    return true;
  }

  try {
    const parsed = new URL(normalizedOrigin);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

const app = express();
// ngrok/localtunnel add X-Forwarded-* headers; trust one upstream proxy.
app.set('trust proxy', 1);
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Socket CORS blocked for origin: ${origin ?? 'unknown'}`));
    },
    methods: ['GET', 'POST'],
    credentials: true
  }
});
setSocketServer(io);

const candidateSocketPresence = new Map<string, { testId: string; attemptId: string }>();

const PORT = process.env.PORT || 3000;

function isHighFrequencyProctoringPath(path: string): boolean {
  return /^\/api\/proctoring\/session\/[^/]+\/(analysis|recording\/upload|snapshot|monitors|violation)$/.test(path);
}

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS blocked for origin: ${origin ?? 'unknown'}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting - adjusted for 100+ concurrent candidates
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000, // higher ceiling for concurrent profiles from same IP
  message: { error: 'Too many requests, please try again later' },
  // Proctoring loop endpoints are high-frequency by design.
  // Keep core anti-abuse limits for other routes.
  skip: (req) => isHighFrequencyProctoringPath(req.path),
});

const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes window
  max: 2000, // allow mass login bursts when many candidates share one NAT IP
  message: { error: 'Too many login attempts, please try again later' }
});

const submissionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5000, // avoid throttling autosave bursts for large concurrent cohorts
  message: { error: 'Too many submissions, please slow down' }
});

app.use(generalLimiter);
app.use(express.json({ limit: '50mb' })); // Increased for media uploads
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Apply auth rate limiter to specific routes
app.use('/api/admin/login', authLimiter);
app.use('/api/admin/register', authLimiter);
app.use('/api/candidate/login', authLimiter);

// Apply submission rate limiter
app.use('/api/candidate/answer', submissionLimiter);
app.use('/api/candidate/test/submit', submissionLimiter);

// Health check
app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch {
    res.status(503).json({
      status: 'degraded',
      database: 'disconnected',
      timestamp: new Date().toISOString()
    });
  }
});

// Routes
app.use('/api/admin', adminRoutes);
app.use('/api/candidate', candidateRoutes);
app.use('/api/proctoring', proctoringRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/invitations', invitationRoutes);

// WebSocket for real-time test monitoring and proctoring
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-test', (testId: string) => {
    socket.join(`test-${testId}`);
    console.log(`Socket ${socket.id} joined test ${testId}`);
  });

  socket.on('admin-join', (adminId: string) => {
    socket.join(`admin-${adminId}`);
    console.log(`Admin ${adminId} joined monitoring`);
  });

  // Admin joins proctoring monitoring for a test
  socket.on('admin-proctor-join', (testId: string) => {
    socket.join(`proctor-${testId}`);
    console.log(`Admin joined proctoring for test ${testId}`);
  });

  // Candidate joins proctoring session
  socket.on('candidate-proctor-join', (data: { attemptId: string; testId: string }) => {
    socket.join(`proctor-attempt-${data.attemptId}`);
    candidateSocketPresence.set(socket.id, data);
    // Notify admin monitoring room
    io.to(`proctor-${data.testId}`).emit('candidate-online', {
      attemptId: data.attemptId,
      testId: data.testId,
      timestamp: new Date().toISOString(),
    });
  });

  // Real-time proctoring violation event
  socket.on('proctor-violation', (data: {
    attemptId: string;
    testId: string;
    violation: {
      type: string;
      severity: string;
      description: string;
      timestamp: string;
    };
  }) => {
    // Broadcast to admin monitoring room
    io.to(`proctor-${data.testId}`).emit('violation-detected', data);
  });

  // Real-time proctoring status update
  socket.on('proctor-status', (data: {
    attemptId: string;
    testId: string;
    status: {
      cameraOn: boolean;
      micOn: boolean;
      screenSharing: boolean;
      faceDetected: boolean;
      lookingAtScreen: boolean;
    };
  }) => {
    io.to(`proctor-${data.testId}`).emit('status-update', data);
  });

  socket.on('candidate-activity', (data: { testId: string; activity: unknown }) => {
    io.to(`proctor-${data.testId}`).emit('activity-update', data);
  });

  // Candidate live frame feed for admin proctor dashboard
  socket.on('candidate-live-frame', (data: {
    testId: string;
    attemptId: string;
    frame: string;
    timestamp: string;
  }) => {
    io.to(`proctor-${data.testId}`).emit('live-frame', data);
  });

  socket.on('disconnect', () => {
    const candidateInfo = candidateSocketPresence.get(socket.id);
    if (candidateInfo) {
      io.to(`proctor-${candidateInfo.testId}`).emit('candidate-offline', {
        attemptId: candidateInfo.attemptId,
        testId: candidateInfo.testId,
        timestamp: new Date().toISOString(),
      });
      candidateSocketPresence.delete(socket.id);
    }
    console.log('Client disconnected:', socket.id);
  });
});

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

function validateDatabaseUrl(): void {
  const databaseUrl = process.env.DATABASE_URL || '';
  // Detect common malformed DSN where '@' in password is not URL-encoded.
  const atMatches = databaseUrl.match(/@/g)?.length || 0;
  if (databaseUrl.startsWith('postgresql://') && atMatches > 1) {
    console.warn(
      'DATABASE_URL may be malformed: multiple "@" detected. If password contains "@", encode it as "%40".'
    );
  }
}

async function startServer(): Promise<void> {
  validateDatabaseUrl();

  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('Database connectivity check: OK');
    console.log(`Allowed frontend origins: ${allowedOrigins.join(', ')}`);
  } catch (error) {
    console.error('Database connectivity check failed. Verify PostgreSQL and DATABASE_URL.', error);
    process.exit(1);
  }

  httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`API endpoints:`);
    console.log(`  - Admin: http://localhost:${PORT}/api/admin`);
    console.log(`  - Candidate: http://localhost:${PORT}/api/candidate`);
    console.log(`  - Proctoring: http://localhost:${PORT}/api/proctoring`);
    console.log(`  - Media: http://localhost:${PORT}/api/media`);
    console.log(`  - Verification: http://localhost:${PORT}/api/verification`);
    console.log(`  - Analytics: http://localhost:${PORT}/api/analytics`);
    console.log(`  - Files: http://localhost:${PORT}/api/files`);
    console.log(`  - Health: http://localhost:${PORT}/api/health`);
  });
}

void startServer();

export { io };
