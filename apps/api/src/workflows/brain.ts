import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { deriveStep, failRun, failStep, listStep, readStep, type DocRef, type LearnParams } from '../lib/brain-learn';
import type { BrainEnv } from '../lib/brain-store';

const PARALLEL = 5;
const READ = { retries: { limit: 2, delay: '8 seconds' as const, backoff: 'exponential' as const }, timeout: '6 minutes' as const };

/**
 * Agent learning from a Drive folder. One durable step per PDF, five in flight at a time (retried twice, a file that still fails is recorded and skipped),
 * progress events and spend are written to D1 for the UI. Final step derives the style profile and the stats.
 */
export class BrainLearnWorkflow extends WorkflowEntrypoint<BrainEnv, LearnParams> {
  async run(event: WorkflowEvent<LearnParams>, step: WorkflowStep): Promise<void> {
    const p = event.payload, env = this.env;
    try {
      const docs = (await step.do('list folder', { retries: { limit: 1, delay: '5 seconds' }, timeout: '2 minutes' }, (() => listStep(env, p)) as never)) as unknown as DocRef[];
      const readOne = async (d: DocRef, i: number) => {
        try {
          await step.do(`read ${i + 1}/${docs.length}`, READ, (() => readStep(env, p, d, i, docs.length)) as never);
        } catch (e) {
          await step.do(`record failure ${i + 1}`, { retries: { limit: 1, delay: '2 seconds' } }, (async () => { await failStep(env, p, d, i, docs.length, e); return true; }) as never);
        }
      };
      // A few documents at a time: one Spark read takes ~25 s, so a 45-file folder finishes in minutes, not half an hour.
      for (let at = 0; at < docs.length; at += PARALLEL) await Promise.all(docs.slice(at, at + PARALLEL).map((d, k) => readOne(d, at + k)));
      await step.do('derive brain', { retries: { limit: 1, delay: '10 seconds' }, timeout: '5 minutes' }, (() => deriveStep(env, p)) as never);
    } catch (e) {
      await failRun(env, p, e);
      throw e;
    }
  }
}
