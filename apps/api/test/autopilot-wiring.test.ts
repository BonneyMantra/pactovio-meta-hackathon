import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '@pactovio/contracts/env';
import type { Classification, InboundMessage, IntakeJob } from '@pactovio/connectors';
import { autopilotStep } from '../src/lib/autopilot';
import { listInbox, saveSettings } from '../src/lib/autopilot-store';
import { registerProposalRunner } from '../src/lib/autopilot-seams';
import { realGetBrain, realReadProposalRun, realStartProposalRun } from '../src/lib/autopilot-wiring';
import { customerFixture } from './customer-fixture';
import { makeEnv } from './helpers';

let base: Env;
let dispose: () => Promise<void>;
let a: Awaited<ReturnType<typeof customerFixture>>, b: Awaited<ReturnType<typeof customerFixture>>, c: Awaited<ReturnType<typeof customerFixture>>;
const created: { id: string; params: unknown }[] = [];
const fakeWorkflow = { create: async (o: { id: string; params: unknown }) => { created.push(o); return { id: o.id }; } };
const wfEnv = () => ({ ...base, PROPOSAL: fakeWorkflow }) as unknown as Env;

const FIXTURE = JSON.parse(readFileSync(join(__dirname, '../../../packages/brain/test/fixtures/RAX-PR-2025-041.json'), 'utf8'));
const proposalJson = (ref: string, status: string) => JSON.stringify({ ...FIXTURE, ref, outcome: { status, decided_on: null, reason: 'r' },
  implementation_plan: FIXTURE.implementation_plan.map((s: object) => ({ start_week: null, ...s })), commercials: { ...FIXTURE.commercials, note: null } });

const MSG: InboundMessage = { id: 'w1', from: 'Meera Nair <meera@sbi-procurement.example>', subject: 'RFQ: e-surveillance for 120 ATMs', body: 'Please quote.', attachments: [{ filename: 'rfq.pdf', r2Key: 'intakes/w/0-rfq.pdf' }], receivedAt: '2026-11-04T01:00:00Z' };
const RFQ: Classification = { door: 'rfp', kind: 'rfq', confidence: 0.93, reason: 'Asks for a price quotation', customer: 'SBI', subject: MSG.subject };
const job = (ws: string, id: string, messageId: string): IntakeJob => ({ intakeId: id, workspaceId: ws, source: 'gmail', provider: 'gmail', messageId });
const addIntake = (ws: string, id: string) => base.DB.prepare("INSERT INTO intakes (id, workspace_id, door, source, title, sender, received_at, status) VALUES (?, ?, 'rfp', 'gmail', 't', 's', '2026-11-04T01:00:00Z', 'classified')").bind(id, ws).run();

beforeAll(async () => {
  ({ env: base, dispose } = await makeEnv());
  a = await customerFixture(base); b = await customerFixture(base); c = await customerFixture(base);
}, 60_000);
afterAll(async () => dispose?.());

describe('realStartProposalRun', () => {
  it('copies present R2 attachments into the proposal, skips missing ones and starts the workflow once', async () => {
    const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
    await base.FILES.put('intakes/w/present.pdf', pdf);
    created.length = 0;
    const r = await realStartProposalRun(wfEnv(), a.workspace, { intakeId: 'intake_s1', title: 'ATM RFQ', text: 'Quote 120 ATMs',
      files: [{ filename: 'present.pdf', mimetype: 'application/pdf', r2Key: 'intakes/w/present.pdf' }, { filename: 'gone.pdf', mimetype: 'application/pdf', r2Key: 'intakes/w/gone.pdf' }] });
    expect(r.status).toBe('queued');
    expect(r.runId).toBe(r.proposalId);
    const row = await base.DB.prepare('SELECT workspace_id, source, intake_id, title, status, input_json FROM proposals WHERE id = ?').bind(r.runId).first<Record<string, string>>();
    expect(row).toMatchObject({ workspace_id: a.workspace, source: 'autopilot', intake_id: 'intake_s1', title: 'ATM RFQ', status: 'queued' });
    const input = JSON.parse(row!.input_json) as { files: { key: string; filename: string; size: number }[]; text: string; intake_id: string };
    expect(input).toMatchObject({ text: 'Quote 120 ATMs', intake_id: 'intake_s1' });
    expect(input.files).toHaveLength(1);
    expect(input.files[0]).toMatchObject({ filename: 'present.pdf', size: pdf.length });
    const stored = await base.FILES.get(input.files[0]!.key);
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(pdf);
    expect(created).toEqual([{ id: r.runId, params: { proposalId: r.runId, workspaceId: a.workspace } }]);
  });
});

describe('realReadProposalRun', () => {
  it('maps proposal status onto run status and 404s for another workspace', async () => {
    const r = await realStartProposalRun(wfEnv(), a.workspace, { intakeId: 'intake_r1', text: 't', files: [] });
    expect(await realReadProposalRun(base, a.workspace, r.runId)).toEqual({ status: 'queued', proposalId: r.runId });
    for (const [db, want] of [['running', 'running'], ['completed', 'ready'], ['failed', 'failed'], ['queued', 'queued']] as const) {
      await base.DB.prepare('UPDATE proposals SET status = ? WHERE id = ?').bind(db, r.runId).run();
      expect(await realReadProposalRun(base, a.workspace, r.runId)).toMatchObject({ status: want, proposalId: r.runId });
    }
    await expect(realReadProposalRun(base, b.workspace, r.runId)).rejects.toMatchObject({ status: 404 });
  });
});

describe('autopilot with the real runner', () => {
  it('starts a run, lists it in the inbox and flips to ready when the proposal completes', async () => {
    registerProposalRunner(realStartProposalRun, realReadProposalRun);
    const env = wfEnv();
    created.length = 0;
    await saveSettings(env, b.workspace, { enabled: true });
    await addIntake(b.workspace, 'intake_e2e');
    const out = await autopilotStep(env, job(b.workspace, 'intake_e2e', 'm-e2e'), b.workspace, MSG, RFQ);
    expect(out).toMatchObject({ action: 'proposal', duplicate: false, status: 'queued' });
    const pid = out!.runId!;
    expect(created).toHaveLength(1);
    expect(await base.DB.prepare('SELECT proposal_id, proposal_run_id, proposal_status FROM autopilot_messages WHERE message_id = ?').bind('m-e2e').first())
      .toMatchObject({ proposal_id: pid, proposal_run_id: pid, proposal_status: 'queued' });

    const [queued] = await listInbox(env, b.workspace);
    expect(queued).toMatchObject({ intake_id: 'intake_e2e', attachments: [], proposal: { proposal_id: pid, status: 'queued', total_inr: null } });

    await base.DB.prepare("UPDATE proposals SET status = 'completed', proposal_json = ? WHERE id = ?").bind(JSON.stringify({ commercials: { total_inr: 6506803 } }), pid).run();
    const [ready] = await listInbox(env, b.workspace);
    expect(ready).toMatchObject({ status: 'ready', proposal: { status: 'ready', proposal_id: pid, total_inr: 6506803 } });
    expect(await base.DB.prepare("SELECT status FROM intakes WHERE id = 'intake_e2e'").first()).toMatchObject({ status: 'ready' });
    expect((await listInbox(env, b.workspace))[0]).toMatchObject({ status: 'ready', proposal: { status: 'ready' } });
  });
});

describe('realGetBrain', () => {
  it('is null for a workspace that has learned nothing and summarises one that has', async () => {
    expect(await realGetBrain(base, c.workspace)).toBeNull();
    const now = new Date().toISOString();
    const stats = { by_solution_type: { own_products: { count: 1, value_inr: 1, value_share: 0.5 } }, win_rate: 0.5,
      by_sector: [{ sector: 'Banking', count: 2, value_inr: 100, won: 1, lost: 1 }],
      top_products: [{ sku: 'RT-AP-8Z', description: 'Rax access point', qty: 4, value_inr: 400, proposals: 2 }] };
    await base.DB.batch([
      base.DB.prepare("INSERT INTO brain_learn_runs (id, workspace_id, folder_id, status, total, started_at) VALUES ('brn_wiringwiringwiring01', ?, 'folderW', 'completed', 2, ?)").bind(c.workspace, now),
      base.DB.prepare("INSERT INTO company_brain (workspace_id, style_json, stats_json, proposals_learned, run_id, learned_at) VALUES (?, NULL, ?, 2, 'brn_wiringwiringwiring01', ?)").bind(c.workspace, JSON.stringify(stats), now),
      base.DB.prepare("INSERT INTO brain_documents (id, workspace_id, run_id, drive_file_id, filename, status, proposal_ref, proposal_json, updated_at) VALUES ('bdoc_w1', ?, 'brn_wiringwiringwiring01', 'fw1', 'a.pdf', 'done', 'RAX/PR/2025/011', ?, ?)").bind(c.workspace, proposalJson('RAX/PR/2025/011', 'won'), now),
      base.DB.prepare("INSERT INTO brain_documents (id, workspace_id, run_id, drive_file_id, filename, status, proposal_ref, proposal_json, updated_at) VALUES ('bdoc_w2', ?, 'brn_wiringwiringwiring01', 'fw2', 'b.pdf', 'done', 'RAX/PR/2025/012', ?, ?)").bind(c.workspace, proposalJson('RAX/PR/2025/012', 'lost'), now),
    ]);
    const s = await realGetBrain(base, c.workspace);
    expect(s).toMatchObject({ proposals_learned: 2, win_rate: 0.5,
      top_products: [{ sku: 'RT-AP-8Z', name: 'Rax access point', count: 2 }], by_sector: [{ sector: 'Banking', count: 2 }],
      by_solution_type: { own_products: { count: 1 } } });
    expect(s!.past_proposals.map((p) => p.ref).sort()).toEqual(['RAX/PR/2025/011', 'RAX/PR/2025/012']);
    expect(s!.past_proposals[0]).toMatchObject({ client: 'Vaigai Mercantile Bank Ltd', solution_type: 'own_plus_external' });
  });
});
