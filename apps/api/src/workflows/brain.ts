import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { deriveStep, failRun, failStep, listStep, progressStep, readStep, sweepStep, type DocRef, type LearnParams } from '../lib/brain-learn';
import type { BrainEnv } from '../lib/brain-store';

const READ = { retries: { limit: 2, delay: '8 seconds' as const, backoff: 'exponential' as const }, timeout: '6 minutes' as const };
const WAIT_ROUNDS = 150; // × 4 s ≈ 10 minutes before unfinished reads are written off.

/**
 * Agent learning from a Drive folder. The run instance lists the folder, then starts one child instance per PDF so every
 * document is read at the same time (a Worker invocation only holds a handful of connections; separate instances do not
 * share that cap). Each child is one durable, retried step; a file that still fails is recorded and skipped. The run waits
 * on the documents' rows in D1, then derives the style profile and the stats. Progress events and spend go to D1 for the UI.
 */
export class BrainLearnWorkflow extends WorkflowEntrypoint<BrainEnv, LearnParams> {
  async run(event: WorkflowEvent<LearnParams>, step: WorkflowStep): Promise<void> {
    const p = event.payload, env = this.env;
    if (p.read) {
      const { doc, index, total } = p.read;
      try {
        await step.do(`read ${index + 1}/${total}`, READ, (() => readStep(env, p, doc, index, total)) as never);
      } catch (e) {
        await step.do('record failure', { retries: { limit: 1, delay: '2 seconds' } }, (async () => { await failStep(env, p, doc, index, total, e); return true; }) as never);
      }
      return;
    }
    try {
      const docs = (await step.do('list folder', { retries: { limit: 1, delay: '5 seconds' }, timeout: '2 minutes' }, (() => listStep(env, p)) as never)) as unknown as DocRef[];
      await step.do('start readers', { retries: { limit: 2, delay: '3 seconds' }, timeout: '1 minute' }, (async () => {
        const batch = docs.map((doc, index) => ({ id: `${p.runId}-d${index + 1}`, params: { runId: p.runId, workspaceId: p.workspaceId, folderId: p.folderId, read: { doc, index, total: docs.length } } }));
        try { await env.BRAIN!.createBatch(batch); }
        catch { for (const b of batch) await env.BRAIN!.create(b).catch(() => undefined); } // A retry after a partial batch: existing ids are skipped.
        return batch.length;
      }) as never);
      for (let k = 0; k < WAIT_ROUNDS; k++) {
        await step.sleep(`wait ${k + 1}`, '4 seconds');
        const left = (await step.do(`check ${k + 1}`, { retries: { limit: 2, delay: '2 seconds' } }, (() => progressStep(env, p)) as never)) as unknown as number;
        if (left <= 0) break;
      }
      await step.do('write off unfinished', { retries: { limit: 1, delay: '2 seconds' } }, (() => sweepStep(env, p, docs)) as never);
      await step.do('derive brain', { retries: { limit: 1, delay: '10 seconds' }, timeout: '5 minutes' }, (() => deriveStep(env, p)) as never);
    } catch (e) {
      await failRun(env, p, e);
      throw e;
    }
  }
}
