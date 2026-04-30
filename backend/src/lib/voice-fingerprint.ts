// Voice fingerprint — derive style statistics from a user's writing samples
// without storing the samples themselves.
//
// All functions here are pure and side-effect-free; they run client-side at
// onboarding (so we never see the raw text) AND server-side as a sanity
// check against malformed input. The output is small (~200 bytes JSON)
// and gets written to public.user_voice_fingerprints.

export interface VoiceFingerprint {
  avg_sentence_words: number;       // e.g. 14.3
  avg_sentence_count: number;       // sentences per message
  formality_score: number;          // 0.0 (casual) to 1.0 (formal)
  contraction_rate: number;         // 0.0 to 1.0 — "we're" vs "we are"
  emoji_rate: number;               // emojis per 100 words
  question_rate: number;            // share of sentences that are questions
  common_openers: string[];         // top 3 starting clauses
  common_signoffs: string[];        // top 3 closing clauses
  signature_phrases: string[];      // distinctive 2-3 word ngrams
  sample_count: number;
}

const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z"'(])/;
const FORMAL_MARKERS = ['regarding', 'pursuant', 'furthermore', 'aforementioned', 'kindly', 'sincerely', 'best regards', 'respectfully'];
const CASUAL_MARKERS = ['gonna', 'wanna', 'yeah', 'cool', 'lol', 'lmk', 'tbh', 'fwiw', 'ngl', '!', '?', '—'];
const CONTRACTIONS_RE = /\b(I'm|you're|we're|they're|it's|that's|don't|doesn't|didn't|can't|won't|wouldn't|couldn't|shouldn't|isn't|aren't|haven't|hasn't|hadn't|let's|here's|there's|where's|what's|who's|how's|I've|you've|we've|they've|I'll|you'll|we'll|they'll|I'd|you'd|we'd|they'd)\b/gi;
const EMOJI_RE = /[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{2700}-\u{27BF}\u{2600}-\u{26FF}]/gu;

/**
 * Compute the fingerprint for a list of message samples. Returns null if
 * input is too thin (need ≥3 messages with ≥10 words each).
 */
export function computeFingerprint(samples: string[]): VoiceFingerprint | null {
  const valid = samples
    .map((s) => (s || '').trim())
    .filter((s) => s.split(/\s+/).filter(Boolean).length >= 10);

  if (valid.length < 3) return null;

  const allWords: string[] = [];
  let totalSentences = 0;
  let totalQuestions = 0;
  let totalContractions = 0;
  let totalEmojis = 0;
  let totalContractionTargets = 0; // count of all word-pairs that COULD have been a contraction
  const openers = new Map<string, number>();
  const signoffs = new Map<string, number>();
  const ngrams = new Map<string, number>();
  let formalHits = 0;
  let casualHits = 0;

  for (const msg of valid) {
    const words = msg.split(/\s+/).filter(Boolean);
    allWords.push(...words);

    const sentences = msg.split(SENTENCE_SPLIT_RE).map((s) => s.trim()).filter(Boolean);
    totalSentences += sentences.length;
    totalQuestions += sentences.filter((s) => s.endsWith('?')).length;

    const contractionMatches = msg.match(CONTRACTIONS_RE);
    totalContractions += contractionMatches ? contractionMatches.length : 0;
    // Approximate "could-have-been-a-contraction" targets: count instances of
    // formal-form word pairs that the user could have contracted.
    const couldHaveContracted = (msg.match(/\b(I am|you are|we are|they are|it is|that is|do not|does not|did not|cannot|will not|would not|could not|should not|is not|are not|have not|has not|had not)\b/gi) || []).length;
    totalContractionTargets += contractionMatches ? contractionMatches.length + couldHaveContracted : couldHaveContracted;

    const emojiMatches = msg.match(EMOJI_RE);
    totalEmojis += emojiMatches ? emojiMatches.length : 0;

    const lower = msg.toLowerCase();
    formalHits += FORMAL_MARKERS.reduce((n, m) => n + (lower.includes(m) ? 1 : 0), 0);
    casualHits += CASUAL_MARKERS.reduce((n, m) => n + (lower.includes(m) ? 1 : 0), 0);

    // Opener = first 1-3 words of the message
    const openerWords = words.slice(0, 3).join(' ').replace(/[.!?]+$/, '');
    if (openerWords) openers.set(openerWords, (openers.get(openerWords) || 0) + 1);

    // Signoff = last 1-4 words
    const signoffWords = words.slice(-4).join(' ').replace(/^[—–-]\s*/, '');
    if (signoffWords) signoffs.set(signoffWords, (signoffs.get(signoffWords) || 0) + 1);

    // Trigrams for signature phrases
    for (let i = 0; i < words.length - 2; i++) {
      const ngram = words.slice(i, i + 3).join(' ').toLowerCase().replace(/[.,!?;:]+$/, '');
      if (ngram.length < 8) continue;
      ngrams.set(ngram, (ngrams.get(ngram) || 0) + 1);
    }
  }

  const avgSentenceWords = totalSentences > 0 ? allWords.length / totalSentences : 0;
  const avgSentenceCount = totalSentences / valid.length;

  // Formality on a 0-1 scale. Heuristic: contractions + casual markers push
  // toward 0; formal markers + long average sentence push toward 1.
  const contractionRate = totalContractionTargets > 0
    ? totalContractions / totalContractionTargets
    : 0.5;
  const formalityRaw = (formalHits - casualHits) / Math.max(formalHits + casualHits + 4, 4);
  const sentenceLengthSignal = Math.max(0, Math.min(1, (avgSentenceWords - 12) / 12));
  const contractionSignal = 1 - contractionRate;
  const formality = Math.max(0, Math.min(1, 0.5 + formalityRaw * 0.4 + sentenceLengthSignal * 0.3 + contractionSignal * 0.3 - 0.5));

  const emojiRate = (totalEmojis / Math.max(allWords.length, 1)) * 100;
  const questionRate = totalSentences > 0 ? totalQuestions / totalSentences : 0;

  const top = (m: Map<string, number>, n: number) =>
    Array.from(m.entries())
      .filter(([k]) => k.split(/\s+/).length > 0 && k.length > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k]) => k);

  return {
    avg_sentence_words: round(avgSentenceWords, 2),
    avg_sentence_count: round(avgSentenceCount, 2),
    formality_score: round(formality, 2),
    contraction_rate: round(contractionRate, 2),
    emoji_rate: round(emojiRate, 3),
    question_rate: round(questionRate, 2),
    common_openers: top(openers, 3),
    common_signoffs: top(signoffs, 3),
    signature_phrases: top(ngrams, 5),
    sample_count: valid.length,
  };
}

/**
 * Convert a fingerprint into a short style guide string the prompt can
 * paste in directly. Used at generation time.
 */
export function fingerprintAsPromptHint(fp: VoiceFingerprint): string {
  const parts: string[] = [];
  if (fp.avg_sentence_words >= 18) parts.push('uses long, considered sentences');
  else if (fp.avg_sentence_words <= 11) parts.push('writes in short, punchy sentences');

  if (fp.formality_score >= 0.7) parts.push('formal register');
  else if (fp.formality_score <= 0.35) parts.push('casual register');

  if (fp.contraction_rate >= 0.6) parts.push("uses contractions ('we're, don't')");
  else if (fp.contraction_rate <= 0.2) parts.push('avoids contractions');

  if (fp.emoji_rate > 0.3) parts.push('occasionally uses emojis');
  if (fp.question_rate >= 0.25) parts.push('asks questions liberally');

  if (fp.common_signoffs.length > 0) {
    parts.push(`signs off with phrasing like "${fp.common_signoffs[0]}"`);
  }

  if (parts.length === 0) return '';
  return `User voice fingerprint: the user typically ${parts.join(', ')}. Match this style.`;
}

function round(n: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}
