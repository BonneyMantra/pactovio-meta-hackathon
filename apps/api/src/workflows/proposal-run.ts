import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env } from '@pactovio/contracts/env';
import { runProposal, type RunParams } from '@pactovio/proposal';

export type ProposalRunParams = RunParams;

/**
 * Durable proposal run. The pipeline persists state after every stage (packages/proposal), so a retried step resumes
 * at the first unfinished stage. Progress is the `proposal_steps` rows the UI polls through GET /api/proposals/:id.
 */
export class ProposalRunWorkflow extends WorkflowEntrypoint<Env, ProposalRunParams> {
  async run(event: WorkflowEvent<ProposalRunParams>, step: WorkflowStep): Promise<void> {
    await step.do('run proposal', { retries: { limit: 1, delay: '10 seconds', backoff: 'constant' }, timeout: '30 minutes' }, async () => {
      await runProposal(this.env, event.payload);
    });
  }
}
