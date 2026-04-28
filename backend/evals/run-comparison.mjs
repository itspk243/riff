#!/usr/bin/env node
//
// Real comparison harness: runs Riff's prompt and a generic-template baseline
// prompt against the same inputs through the actual Claude API. Prints both
// outputs side by side, then optionally asks Claude to blind-judge which one
// reads as more human / more personalized / less template-y.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... node backend/evals/run-comparison.mjs
//   ANTHROPIC_API_KEY=sk-ant-... node backend/evals/run-comparison.mjs --judge
//
// Why this exists: I (Claude, the model that wrote the system prompt) can
// claim our output beats competitors. That's not proof. This script gives you
// real proof — two outputs from the same model on the same input, one with
// our anti-template prompt, one with a generic outreach prompt. You judge.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER = (process.env.LLM_PROVIDER || 'claude').toLowerCase();
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (PROVIDER === 'claude' && !ANTHROPIC_KEY) { console.error('ANTHROPIC_API_KEY required'); process.exit(1); }
if (PROVIDER === 'gemini' && !GEMINI_KEY) { console.error('GEMINI_API_KEY required'); process.exit(1); }
console.log(`Provider: ${PROVIDER}\n`);

const JUDGE = process.argv.includes('--judge');
const CLAUDE_MODEL = process.env.RIFF_CLAUDE_MODEL || 'claude-sonnet-4-6';
const GEMINI_MODEL = process.env.RIFF_GEMINI_MODEL || 'gemini-2.5-flash';

// Load Riff's actual system prompt from the source file (single source of truth)
const promptTs = fs.readFileSync(path.join(__dirname, '../src/lib/prompt.ts'), 'utf8');
const RIFF_SYSTEM_PROMPT = promptTs.match(/export const SYSTEM_PROMPT = `([\s\S]*?)`;/)[1];

// Load the generic-template baseline prompt
const BASELINE_SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'baseline-prompt.txt'), 'utf8').trim();

const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));

function buildRiffUserMessage(req) {
  const p = req.profile;
  const lines = [];
  lines.push('# Candidate profile');
  lines.push(`name: ${p.name || '(unknown)'}`);
  if (p.headline) lines.push(`headline: ${p.headline}`);
  if (p.currentRole || p.currentCompany) lines.push(`currentRole: ${[p.currentRole, p.currentCompany].filter(Boolean).join(' at ')}`);
  if (p.about) lines.push(`about: ${p.about}`);
  lines.push(`recentPost: ${req.recentPost || 'null'}`);
  lines.push('');
  lines.push('# Recruiter pitch');
  lines.push(req.pitch);
  lines.push('');
  lines.push('# Constraints');
  lines.push(`tone: ${req.tone}`);
  lines.push(`length: ${req.length}`);
  lines.push('');
  lines.push('Return ONLY the JSON object.');
  return lines.join('\n');
}

function buildBaselineUserMessage(req) {
  const p = req.profile;
  const lines = [];
  lines.push(`Candidate name: ${p.name}`);
  if (p.headline) lines.push(`Headline: ${p.headline}`);
  if (p.currentRole || p.currentCompany) lines.push(`Current role: ${[p.currentRole, p.currentCompany].filter(Boolean).join(' at ')}`);
  if (p.about) lines.push(`Background: ${p.about}`);
  if (req.recentPost) lines.push(`Recent activity: ${req.recentPost}`);
  lines.push('');
  lines.push(`Role being hired for: ${req.pitch}`);
  return lines.join('\n');
}

function extractFirstJsonObject(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try { JSON.parse(trimmed); return trimmed; } catch {}
  }
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

async function callLLM(system, userMessage, max_tokens = 1200) {
  if (PROVIDER === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: max_tokens, temperature: 0.7 },
    };
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
  const body = {
    model: CLAUDE_MODEL,
    max_tokens,
    system,
    messages: [{ role: 'user', content: userMessage }],
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content.filter(b => b.type === 'text')[0]?.text || '';
}

async function runCase(tc) {
  // Riff prompt → JSON with three variants
  const riffRaw = await callLLM(RIFF_SYSTEM_PROMPT, buildRiffUserMessage(tc));
  const riffJson = extractFirstJsonObject(riffRaw);
  const riffParsed = riffJson ? JSON.parse(riffJson) : null;
  const riffOpener = riffParsed?.variants?.find(v => v.type === 'cold_opener')?.text || '(parse failed)';

  // Baseline prompt → single message text (matches what generic-template tools output)
  const baselineRaw = await callLLM(BASELINE_SYSTEM_PROMPT, buildBaselineUserMessage(tc));
  const baselineText = baselineRaw.trim();

  return { riff: riffOpener, baseline: baselineText };
}

async function judge(tc, riffText, baselineText) {
  const judgePrompt = `You are an experienced senior recruiter. Two cold-outreach messages were drafted for the same candidate by two different tools. Read both blindly and tell me which one would more likely get a reply, and why.

Be honest and specific. If both are bad, say so. If they're equivalent, say so. Don't be diplomatic.

Candidate context:
- Name: ${tc.profile.name}
- Headline: ${tc.profile.headline}
- Current role: ${tc.profile.currentRole} at ${tc.profile.currentCompany}
${tc.recentPost ? `- Recent post: ${tc.recentPost}` : ''}
- Pitch from recruiter: ${tc.pitch}

Message A:
"""
${riffText}
"""

Message B:
"""
${baselineText}
"""

Pick a winner (A, B, or TIE). Then in 2–3 sentences, explain what specifically made it better — was it the opener, the framing, the question, the length, the absence of cliché phrases? Be concrete.

Respond as JSON: {"winner": "A" | "B" | "TIE", "reason": "..."}`;

  const judgeRaw = await callLLM(
    'You are an experienced senior recruiter giving honest, specific feedback on cold-outreach drafts.',
    judgePrompt,
    400
  );
  const json = extractFirstJsonObject(judgeRaw);
  return json ? JSON.parse(json) : { winner: '?', reason: judgeRaw };
}

// Main
const results = [];
for (const tc of cases) {
  console.log('\n' + '='.repeat(72));
  console.log(`Case: ${tc.id}  (tone=${tc.tone}, length=${tc.length})`);
  console.log('='.repeat(72));

  let outputs;
  try {
    outputs = await runCase(tc);
  } catch (e) {
    console.error('  Failed:', e.message);
    continue;
  }

  console.log('\n--- Riff (anti-template prompt) ---');
  console.log(outputs.riff);
  console.log('\n--- Baseline (generic-template prompt) ---');
  console.log(outputs.baseline);

  if (JUDGE) {
    process.stdout.write('\nJudging... ');
    const verdict = await judge(tc, outputs.riff, outputs.baseline);
    console.log(`\nWinner: ${verdict.winner}`);
    console.log(`Reason: ${verdict.reason}`);
    results.push({ case: tc.id, ...verdict });
  }
}

if (JUDGE && results.length > 0) {
  const wins = results.filter(r => r.winner === 'A').length;
  const losses = results.filter(r => r.winner === 'B').length;
  const ties = results.filter(r => r.winner === 'TIE').length;
  console.log('\n' + '='.repeat(72));
  console.log(`SUMMARY: Riff (A) won ${wins}, baseline (B) won ${losses}, ties ${ties} of ${results.length}`);
  console.log('='.repeat(72));
}
