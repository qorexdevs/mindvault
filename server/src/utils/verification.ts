export interface VerificationResult {
  isOriginal: boolean;
  confidence: number;
  flags: string[];
}

// keep confidence inside the 0.0 - 1.0 range the schema and the average in
// /verify expect; a model that answers 95 or -1 would otherwise skew the mean
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function parseVerification(text: string | null | undefined): VerificationResult {
  const trimmed = text?.trim();
  if (!trimmed) {
    return { isOriginal: false, confidence: 0, flags: ["No response from verification model"] };
  }
  try {
    // handle responses wrapped in markdown code blocks
    const cleaned = trimmed.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      isOriginal: Boolean(parsed.is_original),
      confidence: clamp01(Number(parsed.confidence)),
      flags: Array.isArray(parsed.flags) ? parsed.flags : [],
    };
  } catch {
    return { isOriginal: false, confidence: 0, flags: ["Failed to parse verification response"] };
  }
}
