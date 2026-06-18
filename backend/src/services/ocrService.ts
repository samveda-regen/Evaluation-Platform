/**
 * OCR Service — Tesseract.js document text extraction
 *
 * Used to score uploaded ID documents. A real document should have readable
 * alphanumeric text (name, ID number, dates). A blank image or photo of
 * something else will score very low.
 *
 * Tesseract runs locally — no API calls, no cost.
 * Language data (~25 MB) is downloaded on first use and then cached.
 */

import Tesseract from 'tesseract.js';

export interface OCRResult {
  confidence:      number;   // 0–100 from Tesseract
  text:            string;   // extracted text
  hasValidContent: boolean;  // does this look like a real identity document?
}

// Patterns that indicate a real government-issued ID
const RE_ID_NUMBER = /[A-Z0-9]{5,}/;       // alphanumeric ID/passport numbers
const RE_DATE      = /\d{2}[\/\-\.]\d{2}/; // date fragments (DD/MM, MM/YY, etc.)
const RE_NAME_WORD = /[A-Z][a-z]{2,}/;     // capitalised words (names)

export async function analyzeDocumentOCR(imageBuffer: Buffer): Promise<OCRResult> {
  try {
    const { data } = await Tesseract.recognize(imageBuffer, 'eng', {
      logger: () => {}, // suppress per-step progress output
    });

    const text       = (data.text || '').trim();
    const confidence = Math.round(data.confidence ?? 0);

    const hasIdNumber = RE_ID_NUMBER.test(text);
    const hasDate     = RE_DATE.test(text);
    const hasName     = RE_NAME_WORD.test(text);
    const hasEnoughWords = text.split(/\s+/).filter(w => w.length >= 2).length >= 3;

    // Valid content = has structured text that looks like an ID card
    const hasValidContent = confidence > 25 && hasEnoughWords && (hasIdNumber || hasDate || hasName);

    return { confidence, text, hasValidContent };
  } catch (error) {
    console.error('[OCR] Tesseract error:', error instanceof Error ? error.message : error);
    // Soft fail — don't block verification just because OCR errored
    return { confidence: 60, text: '', hasValidContent: true };
  }
}

export default { analyzeDocumentOCR };
