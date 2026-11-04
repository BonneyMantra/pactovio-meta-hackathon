import { describe, expect, it } from 'vitest';
import { RunStopped } from '../../../packages/proposal/src/ctx';
import { runProposal } from '../../../packages/proposal/src/run';

/** A workspace with no catalogue gets an actionable message and no model calls, never a bid priced from guesses. */
describe('runProposal without a catalogue', () => {
  it('stops before any model call with a clear message', async () => {
    const writes: { sql: string; args: unknown[] }[] = [];
    const row = { id: 'prp_x', workspace_id: 'ws_x', title: null, status: 'queued', source: 'chat', intake_id: null, input_json: JSON.stringify({ files: [], text: 'RFQ for 10 ATM alarm panels' }), orchestrator: null, error: null, cost_usd: 0, created_at: '', updated_at: '' };
    const stmt = (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => (/FROM proposals/.test(sql) && /proposal_json/.test(sql) ? { proposal_json: null, state_json: '{}' } : /FROM proposals/.test(sql) ? row : null),
        all: async () => ({ results: [] }),
        run: async () => { writes.push({ sql, args }); return {}; },
      }),
    });
    const fetchImpl = (() => { throw new Error('no model call expected'); }) as unknown as typeof fetch;
    const env = { DB: { prepare: stmt }, FILES: { get: async () => null } } as never;
    await runProposal(env, { proposalId: 'prp_x', workspaceId: 'ws_x' }, { fetchImpl });
    const failed = writes.find((w) => /status = 'failed'/.test(w.sql));
    expect(failed?.args[0]).toMatch(/catalogue is empty/);
    expect(new RunStopped('x').publicMessage).toBe('x');
  });
});
