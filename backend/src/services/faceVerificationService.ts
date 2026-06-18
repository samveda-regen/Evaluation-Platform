/**
 * Face Verification Service
 *
 * Calls the CompreFace instance deployed on DigitalOcean for face comparison.
 * CompreFace uses ArcFace (99.82% LFW accuracy) — no AWS needed.
 *
 * Dual-threshold logic:
 *   similarity >= AUTO_PASS  → verified automatically
 *   similarity >= PENDING    → routed to admin queue for manual review
 *   similarity <  PENDING    → rejected, candidate must retry
 */

const COMPREFACE_BASE_URL = (process.env.COMPREFACE_BASE_URL || '').replace(/\/$/, '');
const COMPREFACE_API_KEY  = process.env.COMPREFACE_API_KEY  || '';
const DET_PROB_THRESHOLD  = parseFloat(process.env.COMPREFACE_DET_PROB_THRESHOLD || '0.9');

// VERIFICATION_FACE_MATCH_THRESHOLD is the auto-pass ceiling (default 85)
const AUTO_PASS_THRESHOLD = parseFloat(process.env.VERIFICATION_FACE_MATCH_THRESHOLD || '85');
// 20 points below auto-pass → route to admin instead of hard-failing
const PENDING_THRESHOLD   = AUTO_PASS_THRESHOLD - 20;

const REQUEST_TIMEOUT_MS  = parseInt(process.env.FACE_VERIFY_TIMEOUT_MS || '10000', 10);

// Circuit breaker — mirrors the pattern in pythonVisionService.ts
const CIRCUIT_FAILURE_THRESHOLD = 4;
const CIRCUIT_OPEN_MS           = 60_000;
let _failureCount    = 0;
let _circuitOpenUntil = 0;

export interface FaceComparisonResult {
  similarity:     number;   // 0–100
  isMatch:        boolean;  // true when similarity >= AUTO_PASS_THRESHOLD
  requiresReview: boolean;  // true when in the pending zone (65–84)
  confidence:     number;   // CompreFace face detection probability 0–100
  error?:         string;
}

function isServiceConfigured(): boolean {
  return COMPREFACE_BASE_URL.length > 0 && COMPREFACE_API_KEY.length > 0;
}

export async function compareFacesViaCompreFace(
  selfieBuffer:   Buffer,
  documentBuffer: Buffer
): Promise<FaceComparisonResult> {
  if (!isServiceConfigured()) {
    console.warn('[FaceVerify] CompreFace not configured — check COMPREFACE_BASE_URL / COMPREFACE_API_KEY');
    return { similarity: 0, isMatch: false, requiresReview: true, confidence: 0, error: 'Face service not configured' };
  }

  if (Date.now() < _circuitOpenUntil) {
    console.warn('[FaceVerify] Circuit open — skipping call');
    return { similarity: 0, isMatch: false, requiresReview: true, confidence: 0, error: 'Face service temporarily unavailable' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const form = new FormData();
    form.append('source_image', new Blob([selfieBuffer],   { type: 'image/jpeg' }), 'selfie.jpg');
    form.append('target_image', new Blob([documentBuffer], { type: 'image/jpeg' }), 'document.jpg');

    const url = `${COMPREFACE_BASE_URL}/api/v1/verification/verify?det_prob_threshold=${DET_PROB_THRESHOLD}`;

    const response = await fetch(url, {
      method:  'POST',
      headers: { 'x-api-key': COMPREFACE_API_KEY },
      body:    form,
      signal:  controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`CompreFace ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json() as Record<string, unknown>;

    // Reset circuit on success
    _failureCount = 0;

    const results = data.result as Array<Record<string, unknown>> | undefined;
    const first   = results?.[0] as Record<string, unknown> | undefined;

    if (!first) {
      return { similarity: 0, isMatch: false, requiresReview: false, confidence: 0, error: 'No face detected in images' };
    }

    const sourceImageFace = first.source_image_face as Record<string, unknown> | undefined;
    const faceMatches     = first.face_matches     as Array<Record<string, unknown>> | undefined;
    const bestMatch       = faceMatches?.[0];

    if (!bestMatch) {
      return { similarity: 0, isMatch: false, requiresReview: false, confidence: 0, error: 'No face detected in ID document' };
    }

    const rawSimilarity = Number(bestMatch.similarity ?? 0);
    const similarity    = Math.round(rawSimilarity * 100);
    const detProb       = Number(sourceImageFace?.det_prob ?? 0);
    const confidence    = Math.round(detProb * 100);

    return {
      similarity,
      isMatch:        similarity >= AUTO_PASS_THRESHOLD,
      requiresReview: similarity >= PENDING_THRESHOLD && similarity < AUTO_PASS_THRESHOLD,
      confidence,
    };
  } catch (error) {
    clearTimeout(timer);

    _failureCount += 1;
    if (_failureCount >= CIRCUIT_FAILURE_THRESHOLD) {
      _circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
      _failureCount     = 0;
      console.warn(`[FaceVerify] Circuit OPEN for ${CIRCUIT_OPEN_MS / 1000}s`);
    }

    const message = error instanceof Error ? error.message : 'Face comparison failed';
    console.error('[FaceVerify] Error:', message);

    return { similarity: 0, isMatch: false, requiresReview: true, confidence: 0, error: message };
  }
}

export default { compareFacesViaCompreFace };
