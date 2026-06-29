import OpenAI from "openai";
import { config } from "../config.js";
import { parseVerification, type VerificationResult } from "../utils/verification.js";

const OpenAIClient = (OpenAI as any).default || OpenAI;

const client = new OpenAIClient({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: config.OPENROUTER_API_KEY,
});

export type { VerificationResult };

export async function checkOriginality(
  content: string,
  resourceType: string
): Promise<VerificationResult> {
  const response = await client.chat.completions.create({
    model: config.OPENROUTER_MODEL,
    max_tokens: 1024,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a content verification agent for a digital marketplace called MindVault. Your job is to verify that submitted content metadata (title, description, and resource reference) represents a legitimate digital resource that a creator would sell.

You are NOT judging the full content — you are reviewing the listing metadata to determine if this appears to be a genuine resource listing.

A resource should be APPROVED if:
- The title and description describe a real digital resource (dataset, code, article, API, prompt, etc.)
- The description shows effort and describes what the buyer gets
- It appears to be a legitimate listing, even if brief

A resource should be REJECTED only if:
- It is clearly spam, gibberish, or meaningless
- It is an obvious test/placeholder with no real intent to sell (e.g. "test123", "asdf")
- It appears to be copied verbatim from a well-known source without attribution

Be lenient — real creators often write short descriptions. Brief is fine. Low effort is fine. Only reject clearly bad listings.

Respond with valid JSON: { "is_original": boolean, "confidence": number (0-1), "flags": string[] }
The flags should be human-readable sentences explaining your reasoning.`,
      },
      {
        role: "user",
        content: `Review this ${resourceType} resource listing:
---
${content.slice(0, 10000)}
---

Respond with JSON only.`,
      },
    ],
  });

  return parseVerification(response.choices[0]?.message?.content);
}
