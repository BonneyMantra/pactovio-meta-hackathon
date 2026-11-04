import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '@pactovio/contracts/env';
import { LOOKBACK_MS, pollAfterSeconds, unseen } from '../src/lib/autopilot-poll';
import { saveSettings, touchChecked, getSettings } from '../src/lib/autopilot-store';
import { customerFixture } from './customer-fixture';
import { makeEnv } from './helpers';

let env: Env;
let dispose: () => Promise<void>;
let a: Awaited<ReturnType<typeof customerFixture>>, b: Awaited<ReturnType<typeof customerFixture>>;
beforeAll(async () => {
  ({ env, dispose } = await makeEnv());
  a = await customerFixture(env); b = await customerFixture(env);
}, 60_000);
afterAll(async () => dispose?.());

const NOW = Date.parse('2026-11-04T10:00:00Z');
const sec = (ms: number) => Math.floor(ms / 1000);

describe('autopilot poll window', () => {
  it('reaches back to when autopilot was switched on, not just the last two minutes', () => {
    const since = NOW - 6 * 3_600_000; // switched on six hours ago
    expect(pollAfterSeconds(since, NOW)).toBe(sec(since - 120_000));
  });
  it('never looks back further than the look-back cap, and never before autopilot was on', () => {
    expect(pollAfterSeconds(NOW - 30 * 86_400_000, NOW)).toBe(sec(NOW - LOOKBACK_MS - 120_000));
    expect(pollAfterSeconds(NOW - 60_000, NOW)).toBe(sec(NOW - 180_000));
  });
  it('a poll no longer moves the "on since" floor; pausing and resuming resets it', async () => {
    const on = await saveSettings(env, a.workspace, { enabled: true });
    await touchChecked(env, a.workspace);
    expect((await getSettings(env, a.workspace)).cursor_ms).toBe(on.cursor_ms);
    await saveSettings(env, a.workspace, { enabled: false });
    await new Promise((r) => setTimeout(r, 5));
    const again = await saveSettings(env, a.workspace, { enabled: true });
    expect(again.cursor_ms!).toBeGreaterThan(on.cursor_ms!);
  });
  it('skips messages already in this workspace ledger, only this workspace', async () => {
    await env.DB.prepare("INSERT INTO intakes (id, workspace_id, door, source, title, sender, received_at, status) VALUES ('intake_p1', ?, 'rfp', 'gmail', 't', 's', '2026-11-04T01:00:00Z', 'classified')").bind(a.workspace).run();
    await env.DB.prepare(`INSERT INTO autopilot_messages (id, workspace_id, message_id, intake_id, kind, confidence, reason, action, created_at, updated_at)
      VALUES ('apm_p1', ?, 'gm-old', 'intake_p1', 'marketing', 0.9, 'r', 'ignored', 'x', 'x')`).bind(a.workspace).run();
    expect(await unseen(env, a.workspace, ['gm-old', 'gm-new'])).toEqual(['gm-new']);
    expect(await unseen(env, b.workspace, ['gm-old'])).toEqual(['gm-old']);
    expect(await unseen(env, a.workspace, [])).toEqual([]);
  });
});
