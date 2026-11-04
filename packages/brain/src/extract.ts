import type { ModelEnv } from '@pactovio/contracts/env';
import { chatJSON, type ChatParams, type StepLogger } from '@pactovio/models';
import { ExtractionSchema, type Extraction } from './schema';

export const EXTRACT_LANE = 'meta:muse-spark-1.3@low';
const SYSTEM = `You read one past commercial proposal PDF issued by Rax Tech International (Chennai) and transcribe it into the given JSON schema.
Rules: copy values exactly as printed (refs, dates, SKUs, quantities, INR amounts as integers, payment terms verbatim); never invent a value that is not in the document;
solution_type is own_products when only Rax-made products are supplied, own_plus_external when third-party items are added, own_plus_custom_engineering when custom engineering work packages exist,
fully_custom_engineered when the system is engineered to order. section_order lists the document's own top-level headings in order. voice_notes are short, concrete observations about how this document is written.`;

/** Muse Spark reads the PDF natively: OpenAI-style `file` content part with a base64 data URL (verified against api.meta.ai). */
export function pdfMessage(bytes: Uint8Array, filename: string): ChatParams['messages'] {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const content = [
    { type: 'file', file: { filename, file_data: `data:application/pdf;base64,${btoa(bin)}` } },
    { type: 'text', text: 'Extract this proposal into the schema.' },
  ];
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: content as never }];
}

export async function extractProposal(env: ModelEnv, bytes: Uint8Array, filename: string, onStep?: StepLogger, fetchImpl?: typeof fetch): Promise<{ extraction: Extraction; costUsd: number; tokensIn: number; tokensOut: number }> {
  const { data, result } = await chatJSON(ExtractionSchema, {
    env, purpose: `brain: read ${filename}`, role: 'reason', model: EXTRACT_LANE, maxTokens: 12_000, timeoutMs: 240_000,
    messages: pdfMessage(bytes, filename), schemaName: 'proposal_extraction', onStep, fetch: fetchImpl,
  });
  return { extraction: data, costUsd: result.costUsd, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}
