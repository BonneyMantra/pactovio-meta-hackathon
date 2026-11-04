import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from 'cloudflare:workers';
import { autopilotStep } from '../lib/autopilot';
import type { Env } from '@pactovio/contracts/env';
import { announceIntake, classifyStep, draftStep, fetchAndStore, markIntakeStatus, routeStep, type IntakeJob } from '@pactovio/connectors';

export type IntakeParams = IntakeJob;

/**
 * Durable intake: fetch the message and attachments, classify (fast-lane), open the right object for the door
 * (design request via lane C, or tender documents + pack run for an RFP), save a reply DRAFT in the mailbox
 * (never sent) and ask for approval. One step per stage, so a crash resumes at the last stage.
 */
export class IntakeWorkflow extends WorkflowEntrypoint<Env, IntakeParams> {
  async run(event: WorkflowEvent<IntakeParams>, step: WorkflowStep): Promise<void> {
    const job = event.payload;
    const retry: WorkflowStepConfig = { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '5 minutes' };
    // Step results are JSON round-tripped by the runtime (undefined fields drop), which the Serializable<T> type cannot express.
    const stage = <T>(name: string, fn: () => Promise<T>): Promise<T> => step.do(name, retry, fn as never) as Promise<T>;
    try {
      const msg = await stage('fetch message', () => fetchAndStore(this.env, job));
      const { cls, workspaceId } = await stage('classify', () => classifyStep(this.env, job, msg));
      const routed = await stage('route', () => routeStep(this.env, job, workspaceId, msg, cls, { announce: false }));
      const ap = await stage('autopilot', () => autopilotStep(this.env, job, workspaceId, msg, cls));
      // Announced after autopilot, so a proposal it already started never leaves a "Start the pack read?" prompt in chat.
      await stage('announce', () => announceIntake(this.env, job, workspaceId, msg, cls, routed,
        ap ? { action: ap.action, proposalId: ap.action === 'proposal' ? ap.runId : null } : null));
      await stage('draft reply', () => draftStep(this.env, job, workspaceId, msg, cls));
    } catch (e) {
      console.error('IntakeWorkflow failed', job.intakeId, e instanceof Error ? e.message.slice(0, 200) : 'unknown');
      await markIntakeStatus(this.env, job.intakeId, 'new').catch(() => undefined);
      throw e;
    }
  }
}
