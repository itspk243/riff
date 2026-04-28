// Backwards-compat shim. The LLM logic moved to ./llm.ts when we added the
// Gemini provider. Existing imports from "./claude" still work because we
// re-export here. New code should import from "./llm" directly.

export { generateVariants, extractFirstJsonObject } from './llm';
