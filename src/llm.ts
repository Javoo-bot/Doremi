import { readFileSync } from 'node:fs';
import OpenAI from 'openai';
import { observeOpenAI } from '@langfuse/openai';
import { parse } from 'yaml';

interface LlmConfig {
  base_url: string;
  models: { transcribe: string; coach: string };
}

export const llmConfig: LlmConfig = parse(readFileSync(new URL('../config/llm.yaml', import.meta.url), 'utf8'));

type KeySlot = 'primary' | 'fallback';

// Auth, out of credits, rate limited: the second key can still succeed. Anything else is a real failure.
const RETRY_WITH_FALLBACK = new Set([401, 402, 429]);

function apiKey(slot: KeySlot): string | undefined {
  return slot === 'primary' ? process.env.OPENROUTER_API_KEY : process.env.FALLBACK_OPEN_ROUTER;
}

function client(slot: KeySlot, generationName: string, metadata: Record<string, unknown>) {
  const openai = new OpenAI({
    apiKey: apiKey(slot),
    baseURL: llmConfig.base_url,
    defaultHeaders: { 'X-Title': 'Doremi' },
  });
  return observeOpenAI(openai, { generationName, generationMetadata: { ...metadata, keySlot: slot } });
}

export async function complete(
  generationName: string,
  body: OpenAI.ChatCompletionCreateParamsNonStreaming,
  metadata: Record<string, unknown> = {},
): Promise<string> {
  // usage.include makes OpenRouter return the real cost, which Langfuse records instead of estimating.
  const params = { ...body, usage: { include: true } } as OpenAI.ChatCompletionCreateParamsNonStreaming;
  let res: OpenAI.ChatCompletion;
  try {
    res = await client('primary', generationName, metadata).chat.completions.create(params);
  } catch (err) {
    if (!(err instanceof OpenAI.APIError && RETRY_WITH_FALLBACK.has(err.status ?? 0) && apiKey('fallback'))) throw err;
    res = await client('fallback', generationName, metadata).chat.completions.create(params);
  }
  return res.choices[0]?.message.content?.trim() ?? '';
}
