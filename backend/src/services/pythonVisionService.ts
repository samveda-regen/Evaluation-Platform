export interface PythonVisionViolation {
  eventType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  description: string;
  metadata?: Record<string, unknown>;
}

export interface PythonVisionResult {
  violations: PythonVisionViolation[];
  face?: {
    detected: boolean;
    count: number;
    confidence: number;
    lookingAtScreen?: boolean;
    gazeDirection?: string;
    gazeConfidence?: number;
    cameraBlocked?: boolean;
  };
  objects?: Array<{
    label: string;
    confidence: number;
    areaRatio?: number;
    source?: string;
  }>;
  stats?: {
    personCount?: number;
    phoneCount?: number;
    displayCount?: number;
    bookCount?: number;
    laptopCount?: number;
    electronicCount?: number;
    cameraBlocked?: boolean;
    yoloLoaded?: boolean;
  };
  aiMeta?: {
    traceId?: string;
    source?: string;
    latencyMs?: number;
    stale?: boolean;
  };
}

type VisionPayload = { frame: string; sessionId?: string };

function normalizeConfidence(confidence: unknown): number {
  const raw = Number(confidence ?? 0);
  if (!Number.isFinite(raw)) return 0;
  if (raw <= 1) return Math.max(0, Math.min(100, raw * 100));
  return Math.max(0, Math.min(100, raw));
}

function normalizeSeverity(severity: unknown): PythonVisionViolation['severity'] {
  const s = String(severity || '').trim().toLowerCase();
  if (s === 'critical' || s === 'high' || s === 'medium' || s === 'low') return s;
  return 'medium';
}

function normalizePythonVisionResult(raw: unknown): PythonVisionResult {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;

  const rawViolations: any[] = Array.isArray(obj.violations)
    ? obj.violations
    : Array.isArray(obj.events)
    ? obj.events
    : Array.isArray(obj.result?.violations)
    ? obj.result.violations
    : [];

  const violations: PythonVisionViolation[] = [];
  for (const v of rawViolations) {
    const eventType = String(v?.eventType || v?.event_type || v?.type || '').trim();
    if (!eventType) continue;
    const violation: PythonVisionViolation = {
      eventType,
      severity: normalizeSeverity(v?.severity),
      confidence: normalizeConfidence(v?.confidence ?? v?.score),
      description: String(v?.description || `${eventType} detected`).trim(),
    };
    if (v?.metadata && typeof v.metadata === 'object') {
      violation.metadata = v.metadata as Record<string, unknown>;
    }
    violations.push(violation);
  }

  const rawFace = (obj.face && typeof obj.face === 'object') ? obj.face : (obj.result?.face || undefined);
  const face = rawFace
    ? {
        detected: Boolean(rawFace.detected ?? rawFace.faceDetected),
        count: Number(rawFace.count ?? rawFace.faceCount ?? 0) || 0,
        confidence: normalizeConfidence(rawFace.confidence),
        lookingAtScreen: rawFace.lookingAtScreen ?? rawFace.isLookingAtScreen,
        gazeDirection: rawFace.gazeDirection,
        gazeConfidence: typeof rawFace.gazeConfidence === 'number'
          ? rawFace.gazeConfidence
          : undefined,
        cameraBlocked: rawFace.cameraBlocked ?? false,
      }
    : undefined;

  const rawObjects: any[] = Array.isArray(obj.objects)
    ? obj.objects
    : Array.isArray(obj.result?.objects)
    ? obj.result.objects
    : [];
  const objects = rawObjects.map((o: any) => ({
    label: String(o?.label || o?.class || '').trim(),
    confidence: normalizeConfidence(o?.confidence ?? o?.score),
    areaRatio: typeof o?.areaRatio === 'number' ? o.areaRatio : undefined,
    source: typeof o?.source === 'string' ? o.source : undefined,
  }));

  const stats = (obj.stats && typeof obj.stats === 'object') ? obj.stats : undefined;
  const aiMeta = (obj.aiMeta && typeof obj.aiMeta === 'object') ? obj.aiMeta : undefined;

  return {
    violations,
    face,
    objects,
    stats,
    aiMeta,
  };
}

function getVisionServiceUrl(): string | null {
  const url = process.env.PYTHON_CV_SERVICE_URL;
  return url && url.trim().length > 0 ? url : null;
}

const PYTHON_CV_TIMEOUT_MS = Number(process.env.PYTHON_CV_TIMEOUT_MS || 6000);
// Retry is disabled by default. When Python is overloaded, retrying compounds the problem —
// the next analysis cycle (4s later) will try again with a fresh frame instead.
const PYTHON_CV_RETRY_COUNT = Number(process.env.PYTHON_CV_RETRY_COUNT || 0);
const PYTHON_CV_RETRY_DELAY_MS = Number(process.env.PYTHON_CV_RETRY_DELAY_MS || 200);

// Circuit breaker: after CV_CIRCUIT_FAILURE_THRESHOLD consecutive failures, stop
// calling the Python service for CV_CIRCUIT_OPEN_MS to let it recover. Prevents
// cascading timeouts from saturating the Node.js event loop.
const CV_CIRCUIT_FAILURE_THRESHOLD = Number(process.env.PYTHON_CV_CIRCUIT_FAILURES || 5);
const CV_CIRCUIT_OPEN_MS = Number(process.env.PYTHON_CV_CIRCUIT_OPEN_MS || 60_000);
let _cvFailureCount = 0;
let _cvCircuitOpenUntil = 0;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callPythonAnalyze(baseUrl: string, payload: VisionPayload): Promise<PythonVisionResult | null> {
  // Circuit breaker check — skip the call entirely if the service is degraded.
  if (Date.now() < _cvCircuitOpenUntil) {
    return null;
  }

  const attempts = Math.max(1, PYTHON_CV_RETRY_COUNT + 1);
  const effectiveTimeoutMs = Math.max(4500, PYTHON_CV_TIMEOUT_MS);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);
    try {
      const response = await fetch(`${baseUrl}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        if (attempt < attempts) {
          await delay(PYTHON_CV_RETRY_DELAY_MS);
          continue;
        }
        _cvFailureCount += 1;
        if (_cvFailureCount >= CV_CIRCUIT_FAILURE_THRESHOLD) {
          _cvCircuitOpenUntil = Date.now() + CV_CIRCUIT_OPEN_MS;
          _cvFailureCount = 0;
          console.warn(`[PythonCV] Circuit breaker OPEN for ${CV_CIRCUIT_OPEN_MS / 1000}s — too many failures`);
        }
        return null;
      }
      // Success — reset failure count.
      _cvFailureCount = 0;
      const data = await response.json();
      return normalizePythonVisionResult(data);
    } catch (error) {
      clearTimeout(timeout);
      if (attempt < attempts) {
        await delay(PYTHON_CV_RETRY_DELAY_MS);
        continue;
      }
      _cvFailureCount += 1;
      if (_cvFailureCount >= CV_CIRCUIT_FAILURE_THRESHOLD) {
        _cvCircuitOpenUntil = Date.now() + CV_CIRCUIT_OPEN_MS;
        _cvFailureCount = 0;
        console.warn(`[PythonCV] Circuit breaker OPEN for ${CV_CIRCUIT_OPEN_MS / 1000}s — too many failures`);
      }
      console.error('Python CV endpoint failed (/analyze):', error);
      return null;
    }
  }
  return null;
}

export async function analyzeFrameWithPython(frameBase64: string): Promise<PythonVisionResult | null> {
  const baseUrl = getVisionServiceUrl();
  if (!baseUrl) return null;
  return callPythonAnalyze(baseUrl, { frame: frameBase64 });
}

export async function analyzeFrameWithPythonForSession(
  frameBase64: string,
  sessionId: string
): Promise<PythonVisionResult | null> {
  const baseUrl = getVisionServiceUrl();
  if (!baseUrl) return null;
  return callPythonAnalyze(baseUrl, { frame: frameBase64, sessionId });
}

export default {
  analyzeFrameWithPython,
  analyzeFrameWithPythonForSession,
};
