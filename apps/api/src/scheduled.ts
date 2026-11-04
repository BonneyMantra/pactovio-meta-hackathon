import { newId } from '@pactovio/contracts';
import type { Env } from '@pactovio/contracts/env';
import { pollAutopilot, POLL_CRON } from './lib/autopilot-poll';
import { warmTenders } from './lib/opportunity-warm';
import { ensureAgentAlarms } from './do/ensure';

/** Cron `0 22 * * *` UTC (06:00 MYT): start the nightly ScanWorkflow. */
export async function handleScheduled(controller: ScheduledController, env: Env): Promise<void> {
  if (controller.cron === POLL_CRON) { // per-minute Gmail autopilot fallback, plus the eager tender read for the same workspaces
    await Promise.all([pollAutopilot(env), warmTenders(env).catch(() => 0)]);
    return;
  }
  await env.SCAN.create({ id: newId('run'), params: { trigger: 'cron' } });
  await ensureAgentAlarms(env); // arm each workspace agent's 06:30 MYT digest alarm
}
