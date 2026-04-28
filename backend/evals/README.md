# Riff evals

Two harnesses. Both require an `ANTHROPIC_API_KEY` env var.

## `run.mjs` — sanity check

Runs Riff's prompt against three benchmark cases. Prints each variant. Runs the hard-check phrase blacklist on each output. Exits non-zero if any output contains a banned phrase.

```
ANTHROPIC_API_KEY=sk-ant-... node backend/evals/run.mjs
```

Use this every time you change the prompt.

## `run-comparison.mjs` — proof of differentiation

This is the answer to "is Riff actually better than competitors?". Runs two prompts against the same inputs through real Claude:

- **Riff prompt** — our actual system prompt with anti-pattern blacklist, conversation-starter framing, three variants per call
- **Baseline prompt** — a generic outreach prompt that mimics what Apollo/Crystal/template tools produce: "greet warmly, reference background, introduce the opportunity, close with a CTA"

Both prompts call the same underlying model. The only difference is the prompt engineering.

```
# Side-by-side, you judge:
ANTHROPIC_API_KEY=sk-ant-... node backend/evals/run-comparison.mjs

# Side-by-side, then a third Claude instance blind-judges each pair:
ANTHROPIC_API_KEY=sk-ant-... node backend/evals/run-comparison.mjs --judge
```

The `--judge` mode pits a senior-recruiter persona against the outputs without telling it which is which, asks it to pick a winner, and reports the score across all cases. This is the actual answer to "does it work better than competitors" — it removes my (Claude's) bias toward defending my own prompt.

If Riff doesn't win the majority of cases on `--judge`, the prompt needs work. If Riff wins by a wide margin, the prompt is doing its job.

## Cost per run

- `run.mjs` — 3 cases × 1 call = ~$0.06
- `run-comparison.mjs` (no judge) — 3 cases × 2 calls = ~$0.10
- `run-comparison.mjs --judge` — 3 cases × 3 calls = ~$0.15

Run as often as you need. The output you see is what real users will see.
