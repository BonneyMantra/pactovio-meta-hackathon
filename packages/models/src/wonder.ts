import { toolLoop, type LoopTool, type ToolLoopResult } from './tool-loop';
import type { ChatMessage, StepLogger } from './types';
import type { ModelEnv } from '@pactovio/contracts/env';

/** Muse Wonder: long-horizon agent runs over the same chat/tool-calling endpoint as Spark (a model id change). */
export const WONDER_LANE = 'meta:muse-wonder-1.0@medium';
export const SPARK_AGENT_LANE = 'meta:muse-spark-1.3@medium';

export interface WonderRun {
  env: ModelEnv;
  purpose: string;
  system: string;
  task: string;
  tools: LoopTool[];
  maxSteps?: number;
  onStep?: StepLogger;
  fetch?: typeof fetch;
  /** Skip Wonder and drive the loop with Spark (tests, or a caller that already saw Wonder fail). */
  forceSpark?: boolean;
}
export interface WonderResult extends ToolLoopResult { orchestrator: string; wonderFailed: boolean }

/**
 * Run an agent loop with Muse Wonder; if Wonder errors (not served, preview outage) the same loop runs on the Spark agent lane.
 * Budget refusals are not retried on another model: they would be refused again.
 */
export async function wonderLoop(r: WonderRun): Promise<WonderResult> {
  const messages: ChatMessage[] = [{ role: 'system', content: r.system }, { role: 'user', content: r.task }];
  const base = { env: r.env, purpose: r.purpose, role: 'agent' as const, messages, tools: r.tools, maxSteps: r.maxSteps ?? 14, onStep: r.onStep, fetch: r.fetch, maxTokens: 1500 };
  if (!r.forceSpark) {
    try {
      const res = await toolLoop({ ...base, model: WONDER_LANE });
      // toolLoop swaps to the reason lane after two failures; that means Wonder did not answer.
      if (!res.fellBack && res.steps.length) return { ...res, orchestrator: res.steps[0]!.model, wonderFailed: false };
    } catch (e) {
      const x = e as { status?: number; code?: string };
      if (x.status === 402) throw e;
    }
  }
  const res = await toolLoop({ ...base, messages: [...messages], model: SPARK_AGENT_LANE });
  return { ...res, orchestrator: res.steps[0]?.model ?? SPARK_AGENT_LANE, wonderFailed: !r.forceSpark };
}
