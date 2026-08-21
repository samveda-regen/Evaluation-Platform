export interface SpeechSegment {
  text: string;
  start: number;
  end: number;
  avgLogprob: number;
}

export interface TranscriptionResult {
  transcript: string;
  segments: SpeechSegment[];
  language: string;
  durationSec: number;
  wordCount: number;
  wordsPerMinute: number;
  pauseCount: number;
  longestPauseSec: number;
  // Pronunciation scoring — optional, null when the Python service's phoneme model
  // isn't available (degrades gracefully; transcript/fluency signals above still work).
  pronunciationAvailable: boolean;
  expectedPhonemes: string | null;
  recognizedPhonemes: string | null;
  phoneErrorRate: number | null;
}

function getSpeechServiceUrl(): string | null {
  const url = process.env.PYTHON_SPEECH_SERVICE_URL;
  return url && url.trim().length > 0 ? url.trim().replace(/\/$/, '') : null;
}

export function isSpeechServiceConfigured(): boolean {
  return getSpeechServiceUrl() !== null;
}

const SPEECH_TIMEOUT_MS = Number(process.env.PYTHON_SPEECH_TIMEOUT_MS || 60_000);

// Unlike pythonVisionService's continuous per-frame calls (which need a circuit breaker to
// avoid saturating the event loop under load), transcription happens once per candidate's
// Speaking answer — a low, bursty call volume where a plain timeout is sufficient.
export async function transcribeAudio(audioBase64: string, mimeType?: string): Promise<TranscriptionResult | null> {
  const baseUrl = getSpeechServiceUrl();
  if (!baseUrl) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SPEECH_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: audioBase64, mimeType }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`Speech service returned ${response.status}: ${body}`);
      return null;
    }

    const data = await response.json() as Record<string, unknown>;
    return {
      transcript: String(data.transcript || ''),
      segments: Array.isArray(data.segments) ? data.segments : [],
      language: String(data.language || ''),
      durationSec: Number(data.durationSec) || 0,
      wordCount: Number(data.wordCount) || 0,
      wordsPerMinute: Number(data.wordsPerMinute) || 0,
      pauseCount: Number(data.pauseCount) || 0,
      longestPauseSec: Number(data.longestPauseSec) || 0,
      pronunciationAvailable: Boolean(data.pronunciationAvailable),
      expectedPhonemes: typeof data.expectedPhonemes === 'string' ? data.expectedPhonemes : null,
      recognizedPhonemes: typeof data.recognizedPhonemes === 'string' ? data.recognizedPhonemes : null,
      phoneErrorRate: typeof data.phoneErrorRate === 'number' ? data.phoneErrorRate : null,
    };
  } catch (error) {
    clearTimeout(timeout);
    console.error('Speech transcription service call failed:', error);
    return null;
  }
}

export default { isSpeechServiceConfigured, transcribeAudio };
