// In-memory rolling aggregates for live telemetry numbers. Nothing here is
// fabricated — every value is derived from real requests/measurements that
// pass through this process. A periodic snapshotter (see index.ts) samples
// these into TelemetrySnapshot for historical charts.

const WINDOW_MS = 5 * 60 * 1000; // 5-minute rolling window for all ring buffers

interface TimedValue {
  value: number;
  at: number;
}

function pruneOld(buffer: TimedValue[]): void {
  const cutoff = Date.now() - WINDOW_MS;
  while (buffer.length > 0 && buffer[0].at < cutoff) {
    buffer.shift();
  }
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

// --- Admin API request outcomes (drives the "failed request rate" metric,
// the honest substitute for an unmeasurable "packet loss %"). ---
const requestOutcomes: TimedValue[] = [];

export function recordActionOutcome(statusCode: number): void {
  requestOutcomes.push({ value: statusCode >= 500 ? 1 : 0, at: Date.now() });
  pruneOld(requestOutcomes);
}

export function getFailedRequestRatePct(): number | null {
  pruneOld(requestOutcomes);
  if (requestOutcomes.length === 0) return null;
  const failed = requestOutcomes.reduce((sum, v) => sum + v.value, 0);
  return Math.round((failed / requestOutcomes.length) * 1000) / 10;
}

// --- Overall admin-API response time — every request, any route, not just
// proctoring/CV calls. This is the "how responsive is the app" number. ---
const apiLatencySamples: TimedValue[] = [];

export function recordApiLatencySample(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  apiLatencySamples.push({ value: durationMs, at: Date.now() });
  pruneOld(apiLatencySamples);
}

export function getApiLatencyPercentiles(): { p50: number | null; p95: number | null } {
  pruneOld(apiLatencySamples);
  const values = apiLatencySamples.map((v) => v.value);
  return { p50: percentile(values, 50), p95: percentile(values, 95) };
}

// --- Overall app rendering smoothness — real requestAnimationFrame-measured
// FPS reported periodically by every open admin tab. This is the "how
// smooth does the UI feel" number, distinct from the proctoring capture
// refresh rate above (which is about candidate camera frames, not the
// admin app's own rendering). ---
const appFpsSamples: TimedValue[] = [];

export function recordAppFpsSample(fps: number): void {
  if (!Number.isFinite(fps) || fps <= 0 || fps > 240) return;
  appFpsSamples.push({ value: fps, at: Date.now() });
  pruneOld(appFpsSamples);
}

export function getAppFps(): number | null {
  pruneOld(appFpsSamples);
  return percentile(appFpsSamples.map((v) => v.value), 50);
}

// --- Socket ping/RTT samples reported by connected admin browser tabs. ---
const pingSamples: TimedValue[] = [];

export function recordPingSample(rttMs: number): void {
  if (!Number.isFinite(rttMs) || rttMs < 0) return;
  pingSamples.push({ value: rttMs, at: Date.now() });
  pruneOld(pingSamples);
}

export function getMedianPingMs(): number | null {
  pruneOld(pingSamples);
  return percentile(pingSamples.map((v) => v.value), 50);
}

// --- CV engine (Python /analyze) round-trip latency, measured server-side. ---
const cvLatencySamples: TimedValue[] = [];

export function recordCvLatencySample(latencyMs: number): void {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
  cvLatencySamples.push({ value: latencyMs, at: Date.now() });
  pruneOld(cvLatencySamples);
}

export function getCvLatencyPercentiles(): { p50: number | null; p95: number | null } {
  pruneOld(cvLatencySamples);
  const values = cvLatencySamples.map((v) => v.value);
  return { p50: percentile(values, 50), p95: percentile(values, 95) };
}

// --- Proctoring frame refresh rate, derived from client-measured
// inter-frame intervals reported alongside each analysis call. ---
const frameIntervalSamples: TimedValue[] = [];

export function recordFrameIntervalSample(intervalMs: number): void {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
  frameIntervalSamples.push({ value: intervalMs, at: Date.now() });
  pruneOld(frameIntervalSamples);
}

export function getRefreshFps(): number | null {
  pruneOld(frameIntervalSamples);
  if (frameIntervalSamples.length === 0) return null;
  const avgIntervalMs =
    frameIntervalSamples.reduce((sum, v) => sum + v.value, 0) / frameIntervalSamples.length;
  if (avgIntervalMs <= 0) return null;
  return Math.round((1000 / avgIntervalMs) * 100) / 100;
}

// Combines every ring-buffer-derived metric into one payload — used by both
// the REST live-telemetry endpoint and the periodic socket "telemetry-tick"
// push, so the two never drift out of sync with each other.
export function getLiveTelemetrySnapshot() {
  const cvLatency = getCvLatencyPercentiles();
  const apiLatency = getApiLatencyPercentiles();
  return {
    medianPingMs: getMedianPingMs(),
    refreshFps: getRefreshFps(),
    cvLatencyP50Ms: cvLatency.p50,
    cvLatencyP95Ms: cvLatency.p95,
    apiLatencyP50Ms: apiLatency.p50,
    apiLatencyP95Ms: apiLatency.p95,
    appFps: getAppFps(),
    failedRequestRatePct: getFailedRequestRatePct(),
    sampleCounts: getRingBufferSampleCounts(),
  };
}

export function getRingBufferSampleCounts(): {
  requestOutcomes: number;
  pingSamples: number;
  cvLatencySamples: number;
  frameIntervalSamples: number;
  apiLatencySamples: number;
  appFpsSamples: number;
} {
  pruneOld(requestOutcomes);
  pruneOld(pingSamples);
  pruneOld(cvLatencySamples);
  pruneOld(frameIntervalSamples);
  pruneOld(apiLatencySamples);
  pruneOld(appFpsSamples);
  return {
    requestOutcomes: requestOutcomes.length,
    pingSamples: pingSamples.length,
    cvLatencySamples: cvLatencySamples.length,
    frameIntervalSamples: frameIntervalSamples.length,
    apiLatencySamples: apiLatencySamples.length,
    appFpsSamples: appFpsSamples.length,
  };
}
