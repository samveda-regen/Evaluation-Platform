import { getAlertConfig, sendAlert } from './alerting.js';

// Tracks how long apiLatencyP95Ms has been continuously above the
// configured threshold; only fires once the breach has been sustained for
// `sustainedMinutes`, and resets the moment latency recovers so a single
// good tick doesn't leave a stale "still breaching" state.
let breachStartedAt: number | null = null;

export async function checkTelemetryThresholds(apiLatencyP95Ms: number | null): Promise<void> {
  if (apiLatencyP95Ms === null) return;

  const config = await getAlertConfig();
  if (!config.enabled || !config.apiLatencyP95ThresholdMs) {
    breachStartedAt = null;
    return;
  }

  if (apiLatencyP95Ms <= config.apiLatencyP95ThresholdMs) {
    breachStartedAt = null;
    return;
  }

  if (breachStartedAt === null) {
    breachStartedAt = Date.now();
    return;
  }

  const sustainedMs = config.sustainedMinutes * 60_000;
  if (Date.now() - breachStartedAt >= sustainedMs) {
    await sendAlert({
      type: 'telemetry_threshold',
      severity: 'warning',
      message: `API latency p95 has been above ${config.apiLatencyP95ThresholdMs}ms for ${config.sustainedMinutes}+ minutes (currently ${Math.round(apiLatencyP95Ms)}ms).`,
      meta: { apiLatencyP95Ms, thresholdMs: config.apiLatencyP95ThresholdMs },
      cooldownKey: 'api_latency',
    });
  }
}
