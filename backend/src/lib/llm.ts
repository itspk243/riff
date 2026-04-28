// LLM provider abstraction.
//
// Swap providers via the LLM_PROVIDER env var. The rest of the codebase calls
// generateVariants(req) and doesn't care which model is behind it.
//
// Supported providers:
//   - "claude" (default) — Anthropic Claude Sonnet 4.6, with prompt caching.
//                          Best output quality. Costs ~$0.012/call cached.
//   - "gemini"           — Google Gemini 2.5 Flash, free tier (~1500 req/day).
//                          Slightly lower quality than Claude on nuanced
//                          personalization tasks but very serviceable.
//                          Use for launch validation, switch to Claude when
//                          revenue covers it.
//
// To validate quality before swapping providers in production, run:
//   ANTHROPIC_API_KEY=... GEMINI_API_KEY=... node backend/evals/run-comparison.mjs --providers
//
// (which compares both providers' outputs on the same inputs)

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { SYSTEM_PROMPT, buildUserMessage, variantPassesHardChecks } from './prompt';
import type { GenerateRequest, MessageVariant } from './types';

type ProviderName = 'claude' | 'gemini';

function activeProvider(): ProviderName {
  const raw = (process.env.LLM_PROVIDER || 'claude').toLowerCase();
  if (raw === 'gemini') return 'gemini';
  return 'claude';
}

// ---------- public API ----------

/**
 * Single source of truth for generation. Calls the active provider, retries
 * once with a stronger reminder if the output trips the hard-check blacklist,
 * returns three validated variants.
 */
export async function generateVariants(req: GenerateRequest): Promise<MessageVariant[]> {
  const variants = await callOnce(req, false);
  if (variants.every(variantPassesHardChecks)) return variants;

  // Even if the retry isn't perfect, return it — better than failing the user.
  return await callOnce(req, true);
}

async function callOnce(req: GenerateRequest, retry: boolean): Promise<MessageVariant[]> {
  const userMessage = retry
    ? buildUserMessage(req) +
      '\n\n# Critical: your previous attempt used a banned phrase from the anti-pattern blacklist. Re-read the blacklist and produce output that strictly avoids those phrases and structures.'
    : buildUserMessage(req);

  const provider = activeProvider();
  const raw = provider === 'gemini'
    ? await callGemini(SYSTEM_PROMPT, userMessage)
    : await callClaude(SYSTEM_PROMPT, userMessage);

  return parseVariants(raw);
}

// ---------- providers ----------

async function callClaude(system: string, userMessage: string): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const model = process.env.RIFF_CLAUDE_MODEL || 'claude-sonnet-4-6';

  // Prompt caching: system prompt is identical on every call (only the user
  // message varies). cache_control: ephemeral lets Anthropic cache it server-side
  // — subsequent calls within ~5 minutes pay ~10% of normal input cost.
  const resp = await client.messages.create({
    model,
    max_tokens: 1200,
    system: [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ] as any, // SDK type lags the cache_control field on system blocks
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlocks = resp.content.filter((b: { type: string }) => b.type === 'text');
  if (textBlocks.length === 0) throw new Error('Claude returned no text content');
  return (textBlocks[0] as { type: 'text'; text: string }).text;
}

async function callGemini(system: string, userMessage: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY required when LLM_PROVIDER=gemini');
  }
  const client = new GoogleGenerativeAI(apiKey);
  const modelName = process.env.RIFF_GEMINI_MODEL || 'gemini-2.5-flash';

  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction: system,
    generationConfig: {
      // Force JSON output so we don't have to fight prose-around-JSON drift.
      responseMimeType: 'application/json',
      // 1500 was too low — Gemini truncated mid-message on real profiles, leaving
      // unterminated JSON. 4000 is comfortable headroom for 3 medium-length variants.
      maxOutputTokens: 4000,
      temperature: 0.7,
    },
  });

  const result = await model.generateContent(userMessage);
  const text = result.response.text();
  if (!text) throw new Error('Gemini returned no text');
  return text;
}

// ---------- shared parsing ----------

function parseVariants(raw: string): MessageVariant[] {
  const cleaned = extractFirstJsonObject(raw);
  if (!cleaned) {
    throw new Error(`Model output had no JSON object: ${raw.slice(0, 200)}`);
  }

  let parsed: { variants?: MessageVariant[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Model output was not valid JSON: ${cleaned.slice(0, 200)}`);
  }

  if (!parsed.variants || !Array.isArray(parsed.variants) || parsed.variants.length !== 3) {
    throw new Error('Model output did not contain 3 variants');
  }
  for (const v of parsed.variants) {
    if (!v.type || !v.text || typeof v.text !== 'string') {
      throw new Error('Model output had a malformed variant');
    }
  }
  return parsed.variants;
}

/**
 * Extract the first balanced JSON object from a string. Handles plain JSON,
 * fenced code blocks, prose before/after the JSON, strings containing braces,
 * and escaped quotes.
 */
export function extractFirstJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try { JSON.parse(trimmed); return trimmed; } catch { /* fall through */ }
  }
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
