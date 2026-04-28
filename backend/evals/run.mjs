#!/usr/bin/env node
// Run the Riff prompt against the eval cases using a real Anthropic API key.
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... node backend/evals/run.mjs
//
// Outputs each case's three variants and runs the hard-check blacklist against
// each. Prints a pass/fail count at the end.
//
// This is the ONLY way to truly validate output quality before launch — the
// stub mocks aren't a substitute. Run this anytime you change the prompt.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER = (process.env.LLM_PROVIDER || 'claude').toLowerCase();
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (PROVIDER === 'claude' && !ANTHROPIC_KEY) {
  console.error('ANTHROPIC_API_KEY required (LLM_PROVIDER=claude)');
  process.exit(1);
}
if (PROVIDER === 'gemini' && !GEMINI_KEY) {
  console.error('GEMINI_API_KEY required (LLM_PROVIDER=gemini)');
  process.exit(1);
}
console.log(`Provider: ${PROVIDER}`);

// Read system prompt + user-message builder by inlining the logic we need.
// (Avoids importing TS files from a plain .mjs.)
const promptTs = fs.readFileSync(path.join(__dirname, '../src/lib/prompt.ts'), 'utf8');
const SYSTEM_PROMPT = promptTs.match(/export const SYSTEM_PROMPT = `([\s\S]*?)`;/)[1];

function buildUserMessage(req) {
  const p = req.profile;
  const lines = [];
  lines.push('# Candidate profile');
  lines.push(`name: ${p.name || '(unknown)'}`);
  if (p.headline) lines.push(`headline: ${p.headline}`);
  if (p.currentRole || p.currentCompany) {
    lines.push(`currentRole: ${[p.currentRole, p.currentCompany].filter(Boolean).join(' at ')}`);
  }
  if (p.about) lines.push(`about: ${p.about.slice(0, 1500)}`);
  lines.push(`recentPost: ${req.recentPost ? req.recentPost.slice(0, 1500) : 'null'}`);
  lines.push('');
  lines.push('# Recruiter pitch');
  lines.push(req.pitch);
  lines.push('');
  lines.push('# Constraints');
  lines.push(`tone: ${req.tone}`);
  lines.push(`length: ${req.length}`);
  lines.push('');
  lines.push('Generate the three variants now. Return ONLY the JSON object.');
  return lines.join('\n');
}

const HARD_FAIL_PHRASES = [
  /i came across your/i,
  /your impressive (background|experience)/i,
  /great fit/i,
  /hope (you'?re|this finds you) (doing )?well/i,
  /scaling challenges/i,
  /rockstar|ninja|guru/i,
  /looking forward to hearing from you/i,
  /exciting opportunity/i,
];

function variantPasses(v) {
  if (!v.text || v.text.length < 20) return false;
  return HARD_FAIL_PHRASES.every(re => !re.test(v.text));
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

async function runOne(testCase) {
  const userMessage = buildUserMessage(testCase);
  const text = PROVIDER === 'gemini'
    ? await callGemini(SYSTEM_PROMPT, userMessage)
    : await callAnthropic(SYSTEM_PROMPT, userMessage);
  const json = extractFirstJsonObject(text);
  if (!json) throw new Error('No JSON in response: ' + text.slice(0, 200));
  return JSON.parse(json);
}

async function callAnthropic(system, userMessage) {
  const body = {
    model: process.env.RIFF_CLAUDE_MODEL || 'claude-sonnet-4-6',
    max_tokens: 1200,
    system,
    messages: [{ role: 'user', content: userMessage }],
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content.filter(b => b.type === 'text')[0]?.text || '';
}

async function callGemini(system, userMessage) {
  const model = process.env.RIFF_GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 1500,
      temperature: 0.7,
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));

let totalPass = 0, totalFail = 0;
for (const tc of cases) {
  console.log('\n=== Case:', tc.id, `(${tc.tone}/${tc.length}) ===`);
  try {
    const out = await runOne(tc);
    for (const v of out.variants) {
      const ok = variantPasses(v);
      console.log(`\n[${v.type}]${ok ? ' ✓' : ' ✗ blacklisted phrase'}`);
      console.log(v.text);
      if (ok) totalPass++; else totalFail++;
    }
  } catch (e) {
    console.error('Case failed:', e.message);
    totalFail += 3;
  }
}

console.log(`\n\n=== Summary: ${totalPass} pass, ${totalFail} fail (${cases.length * 3} total) ===`);
process.exit(totalFail > 0 ? 1 : 0);
