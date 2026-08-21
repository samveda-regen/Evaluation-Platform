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
import integrationRoutes from './routes/integration.js';
import superadminRoutes from './routes/superadmin.js';
import { setSocketServer } from './services/socketService.js';
import { adminActionLogger } from './middleware/adminActionLogger.js';
import { verifyToken } from './utils/jwt.js';
import { SUPERADMIN_ROOM, emitToSuperAdminRoom } from './services/socketService.js';
import { recordPingSample, recordAppFpsSample, getLiveTelemetrySnapshot } from './services/telemetryRingBuffer.js';
import prisma from './utils/db.js';
import { ensureNotificationTable } from './controllers/notifications.js';
import { startTestExpirySweep } from './services/testExpiryService.js';
import { startInvitationReminderSweep } from './services/testReminderService.js';
import { ensureDefaultFeatureFlags } from './controllers/superAdminFeatureFlags.js';
import { ensureDefaultBillingPlans } from './services/billing.js';
import { checkTelemetryThresholds } from './services/telemetryAlerting.js';
import { runAnomalyDetection } from './services/anomalyLock.js';
import { runScheduledDeletions } from './services/softDelete.js';

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
const adminSocketPresence = new Map<string, { adminId: string; adminEmail?: string }>();

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
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use('/api/media', express.json({ limit: '200mb' }));
app.use('/api/media', express.urlencoded({ extended: true, limit: '200mb' }));

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000,
  message: { error: 'Too many requests, please try again later' },
  skip: (req) => isHighFrequencyProctoringPath(req.path),
});

const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 2000,
  message: { error: 'Too many login attempts, please try again later' }
});

const submissionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5000,
  message: { error: 'Too many submissions, please slow down' }
});

const integrationAuthLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 100,
  message: { error: 'Too many integration auth attempts, please try again later' }
});

const integrationApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: 'Too many integration API requests, please slow down' }
});

app.use(generalLimiter);
// 80mb gives headroom for Speaking-answer recordings sent as base64 JSON (which inflates the raw
// audio size by ~33%) — a 600s recording (the admin-configurable max, see communicationQuestion.ts)
// is only a few MB at realistic voice bitrates, so this is generous margin, not a loosened ceiling.
app.use(express.json({ limit: '80mb' }));
app.use(express.urlencoded({ extended: true, limit: '80mb' }));
app.use(cookieParser());

app.use('/api/admin/login', authLimiter);
app.use('/api/admin/register', authLimiter);
app.use('/api/admin/forgot-password', authLimiter);
app.use('/api/admin/reset-password', authLimiter);
app.use('/api/candidate/login', authLimiter);
app.use('/api/superadmin/login', authLimiter);
app.use('/api/admin/refresh-token', authLimiter);
app.use('/api/superadmin/refresh-token', authLimiter);

// Superadmin Observer: guaranteed-complete admin activity log. Registered
// before route mounting so it observes every admin request regardless of
// which route file handled it (see adminActionLogger.ts for how).
app.use(adminActionLogger);

app.use('/api/candidate/answer', submissionLimiter);
app.use('/api/candidate/test/submit', submissionLimiter);

app.use('/api/integration/auth/exchange', integrationAuthLimiter);
app.use('/api/integration/auth/refresh', integrationAuthLimiter);
app.use('/api/integration', integrationApiLimiter);

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

app.get('/api/health/proctoring', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    profile: (process.env.PROCTOR_PROFILE || 'strict').toLowerCase(),
    cvMode: (process.env.PROCTOR_CV_MODE || 'sync').toLowerCase(),
  });
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
app.use('/api/integration', integrationRoutes);
app.use('/api/superadmin', superadminRoutes);

// WebSocket
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-test', (testId: string) => {
    socket.join(`test-${testId}`);
    console.log(`Socket ${socket.id} joined test ${testId}`);
  });

  socket.on('admin-join', (adminId: string) => {
    socket.join(`admin-${adminId}`);
    adminSocketPresence.set(socket.id, { adminId });
    emitToSuperAdminRoom('admin-online', { adminId, timestamp: new Date().toISOString() });
    console.log(`Admin ${adminId} joined monitoring`);
  });

  // Unlike admin-join above (which trusts a bare client-supplied id — a
  // pre-existing gap in this codebase), superadmin-join carries the actual
  // JWT and is verified server-side before the socket is allowed into the
  // observer room, since that room silently streams every admin's activity.
  socket.on('superadmin-join', (token: string) => {
    const payload = typeof token === 'string' ? verifyToken(token) : null;
    if (!payload || payload.role !== 'superadmin') {
      socket.emit('superadmin-join-rejected', { reason: 'invalid_token' });
      return;
    }
    socket.join(SUPERADMIN_ROOM);
    socket.emit('superadmin-join-accepted', {
      onlineAdmins: [...new Set([...adminSocketPresence.values()].map((p) => p.adminId))],
    });
  });

  // App-level echo used to measure real round-trip latency for admin
  // sessions (Socket.io doesn't expose transport-level RTT to app code).
  socket.on('latency-ping', (clientTs: number) => {
    socket.emit('latency-pong', clientTs);
  });

  socket.on('report-latency', (rttMs: number) => {
    recordPingSample(rttMs);
  });

  // Real browser-measured rendering FPS from an admin tab's own
  // requestAnimationFrame loop — the "how smooth does the UI feel" signal.
  socket.on('report-app-fps', (fps: number) => {
    recordAppFpsSample(fps);
  });

  socket.on('admin-proctor-join', (testId: string) => {
    socket.join(`proctor-${testId}`);
    console.log(`Admin joined proctoring for test ${testId}`);
  });

  socket.on('candidate-proctor-join', (data: { attemptId: string; testId: string }) => {
    socket.join(`proctor-attempt-${data.attemptId}`);
    candidateSocketPresence.set(socket.id, data);
    io.to(`proctor-${data.testId}`).emit('candidate-online', {
      attemptId: data.attemptId,
      testId: data.testId,
      timestamp: new Date().toISOString(),
    });
  });

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
    io.to(`proctor-${data.testId}`).emit('violation-detected', data);
  });

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

    const adminInfo = adminSocketPresence.get(socket.id);
    if (adminInfo) {
      // Only announce fully offline once no other socket (e.g. another tab)
      // for the same admin is still connected.
      const stillConnectedElsewhere = [...adminSocketPresence.entries()].some(
        ([id, info]) => id !== socket.id && info.adminId === adminInfo.adminId
      );
      adminSocketPresence.delete(socket.id);
      if (!stillConnectedElsewhere) {
        emitToSuperAdminRoom('admin-offline', {
          adminId: adminInfo.adminId,
          timestamp: new Date().toISOString(),
        });
      }
    }

    console.log('Client disconnected:', socket.id);
  });
});

// Error handling middleware
app.use((err: Error & { type?: string; status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // body-parser (express.json/urlencoded) throws this specific error type when a request exceeds
  // the size limit above — without this check it fell through to the generic 500 below, which is
  // why an oversized recording upload previously looked like an unexplained "can't be saved".
  if (err.type === 'entity.too.large' || err.status === 413) {
    res.status(413).json({ error: 'This file is too large to upload. Please use a shorter recording or a smaller file.' });
    return;
  }
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Periodically samples the live telemetry ring buffers into TelemetrySnapshot
// so the Superadmin Observer's history charts show real sampled data, never
// invented. The "live" numbers themselves are pushed to the observer room in
// real time (see TELEMETRY_TICK_INTERVAL_MS below) so the Telemetry screen
// updates on its own — no manual refresh needed — and are also served on
// demand via the REST endpoint (superAdminTelemetry.ts::getLiveTelemetry)
// for the initial page load.
const TELEMETRY_SNAPSHOT_INTERVAL_MS = 60_000;
async function snapshotTelemetry(): Promise<void> {
  try {
    const activeSessions = await prisma.proctorSession.count({ where: { endedAt: null } });
    // sampleCounts isn't a TelemetrySnapshot column — it's diagnostic-only,
    // included in the live/tick payloads but not persisted.
    const { sampleCounts: _sampleCounts, ...persistable } = getLiveTelemetrySnapshot();
    const snapshot = await prisma.telemetrySnapshot.create({
      data: { activeSessions, ...persistable },
    });
    emitToSuperAdminRoom('telemetry-snapshot', snapshot);
  } catch (error) {
    console.error('Telemetry snapshot failed:', error);
  }
}

const TELEMETRY_TICK_INTERVAL_MS = 3_000;
async function tickLiveTelemetry(): Promise<void> {
  try {
    const activeSessions = await prisma.proctorSession.count({ where: { endedAt: null } });
    const snapshot = getLiveTelemetrySnapshot();
    emitToSuperAdminRoom('telemetry-tick', {
      capturedAt: new Date().toISOString(),
      activeSessions,
      ...snapshot,
    });
    void checkTelemetryThresholds(snapshot.apiLatencyP95Ms);
  } catch (error) {
    console.error('Telemetry tick failed:', error);
  }
}

const ANOMALY_DETECTION_INTERVAL_MS = 10 * 60 * 1000;
const SCHEDULED_DELETION_INTERVAL_MS = 15 * 60 * 1000;

function validateDatabaseUrl(): void {
  const databaseUrl = process.env.DATABASE_URL || '';
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
    // Ensure the Notification table exists (idempotent, safe to run every startup)
    await ensureNotificationTable();
    console.log('Notification table: ready');

    await ensureDefaultFeatureFlags();
    console.log('Feature flags: ready');

    await ensureDefaultBillingPlans();
    console.log('Billing plans: ready (billing disabled by default)');

    // Ensure extended Test columns exist (idempotent)
    await prisma.$executeRaw`ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "proctoringSettings" TEXT`;
    await prisma.$executeRaw`ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "violationPopupSettings" TEXT`;
    await prisma.$executeRaw`ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "confirmEmailSubject" TEXT`;
    await prisma.$executeRaw`ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "confirmEmailBody" TEXT`;
    await prisma.$executeRaw`ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "inviteEmailSubject" TEXT`;
    await prisma.$executeRaw`ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "inviteEmailBody" TEXT`;
    console.log('Test extended columns: ready');

    // Recruiter-platform integration: company-scoped candidates, multi-partner
    // JWT config, per-company result webhooks, and an audit trail. Added via
    // idempotent raw SQL (like the Test columns above) instead of `prisma db push`,
    // since this database has tables/columns outside schema.prisma that a full
    // push would otherwise try to drop.
    await prisma.$executeRaw`ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "companyId" TEXT`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Candidate_companyId_idx" ON "Candidate"("companyId")`;
    await prisma.$executeRaw`ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "webhookUrl" TEXT`;
    await prisma.$executeRaw`ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "webhookSecret" TEXT`;
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "IntegrationPartner" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "slug" TEXT NOT NULL UNIQUE,
        "jwtSecret" TEXT NOT NULL,
        "jwtIssuer" TEXT,
        "jwtAudience" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "IntegrationPartner_jwtIssuer_idx" ON "IntegrationPartner"("jwtIssuer")`;
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "IntegrationAuditLog" (
        "id" TEXT PRIMARY KEY,
        "companyId" TEXT,
        "actorId" TEXT NOT NULL,
        "actorEmail" TEXT,
        "action" TEXT NOT NULL,
        "method" TEXT NOT NULL,
        "path" TEXT NOT NULL,
        "statusCode" INTEGER,
        "metadata" TEXT,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "IntegrationAuditLog_companyId_idx" ON "IntegrationAuditLog"("companyId")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "IntegrationAuditLog_createdAt_idx" ON "IntegrationAuditLog"("createdAt")`;

    // One-time (per-candidate) backfill: tag existing candidates with the company of
    // their earliest test attempt. No-op once a candidate has a companyId.
    await prisma.$executeRaw`
      UPDATE "Candidate" c
      SET "companyId" = sub."companyId"
      FROM (
        SELECT DISTINCT ON (ta."candidateId") ta."candidateId", t."companyId"
        FROM "TestAttempt" ta
        JOIN "Test" t ON t.id = ta."testId"
        WHERE t."companyId" IS NOT NULL
        ORDER BY ta."candidateId", ta."startTime" ASC
      ) sub
      WHERE c.id = sub."candidateId" AND c."companyId" IS NULL
    `;
    console.log('Integration extended tables/columns: ready');

    // Per-admin FeatureFlag exceptions (Superadmin Observer's account-scoped
    // feature locks). Created idempotently here rather than via `prisma db push`,
    // consistent with the other tables above.
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "FeatureFlagOverride" (
        "id" TEXT PRIMARY KEY,
        "featureKey" TEXT NOT NULL,
        "adminId" TEXT NOT NULL,
        "enabled" BOOLEAN NOT NULL,
        "updatedByEmail" TEXT,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `;
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "FeatureFlagOverride_featureKey_adminId_key" ON "FeatureFlagOverride"("featureKey", "adminId")`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "FeatureFlagOverride_adminId_idx" ON "FeatureFlagOverride"("adminId")`;
    console.log('Feature flag overrides table: ready');
  } catch (error) {
    console.error('Database connectivity check failed. Verify PostgreSQL and DATABASE_URL.', error);
    process.exit(1);
  }

  startTestExpirySweep();
  console.log('Test expiry sweep: started');

  startInvitationReminderSweep();
  console.log('Invitation reminder sweep: started');

  setInterval(() => void snapshotTelemetry(), TELEMETRY_SNAPSHOT_INTERVAL_MS);
  setInterval(() => void tickLiveTelemetry(), TELEMETRY_TICK_INTERVAL_MS);
  setInterval(() => void runAnomalyDetection(), ANOMALY_DETECTION_INTERVAL_MS);
  setInterval(() => void runScheduledDeletions(), SCHEDULED_DELETION_INTERVAL_MS);

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
