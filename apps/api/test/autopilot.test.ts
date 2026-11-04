import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '@pactovio/contracts/env';
import { classifyEmail, type Classification, type InboundMessage, type IntakeJob } from '@pactovio/connectors';
import { buildApp } from '../src/app';
import { autopilotStep } from '../src/lib/autopilot';
import { registerProposalRunner, type ProposalRunInput } from '../src/lib/autopilot-seams';
import { brainText } from '../src/lib/opportunity-brain';
import { keepGrounded, normUrl, searchProspects } from '../src/lib/prospects';
import { patchData } from '../src/lib/onboarding-state';
import { saveSettings } from '../src/lib/autopilot-store';
import { customerFixture } from './customer-fixture';
import { makeEnv } from './helpers';

let env: Env;
let dispose: () => Promise<void>;
let a: Awaited<ReturnType<typeof customerFixture>>, b: Awaited<ReturnType<typeof customerFixture>>;
const { app } = buildApp();
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const call = (path: string, cookie: string, init: RequestInit = {}) => app.fetch(new Request(`http://localhost${path}`, { ...init, headers: { cookie, origin: 'http://localhost', 'content-type': 'application/json', ...(init.headers as Record<string, string>) } }), env, ctx);

const chatReply = (content: object | string) => (async () => new Response(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: 'm',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }),
  { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

const MSG: InboundMessage = { id: 'g1', from: 'Meera Nair <meera@sbi-procurement.example>', subject: 'RFQ: e-surveillance for 120 ATMs', body: 'Please quote.', attachments: [{ filename: 'rfq.pdf', r2Key: 'intakes/x/0-rfq.pdf' }], receivedAt: '2026-11-04T01:00:00Z' };
const cls = (kind: Classification['kind'], confidence = 0.92): Classification => ({ door: kind === 'rfq' || kind === 'rfp' ? 'rfp' : kind === 'design_request' ? 'design' : 'other', kind, confidence, reason: `Looks like ${kind}`, customer: 'SBI', subject: MSG.subject });
const job = (ws: string, id: string, messageId: string): IntakeJob => ({ intakeId: id, workspaceId: ws, source: 'gmail', provider: 'gmail', messageId });
const addIntake = (ws: string, id: string) => env.DB.prepare("INSERT INTO intakes (id, workspace_id, door, source, title, sender, received_at, status) VALUES (?, ?, 'rfp', 'gmail', 't', 's', '2026-11-04T01:00:00Z', 'classified')").bind(id, ws).run();

beforeAll(async () => {
  ({ env, dispose } = await makeEnv());
  a = await customerFixture(env); b = await customerFixture(env);
}, 60_000);
afterAll(async () => dispose?.());

describe('classification parsing', () => {
  it('maps the six kinds onto intake doors', async () => {
    const out = await classifyEmail(env, MSG, { fetch: chatReply({ kind: 'rfq', confidence: 0.95, reason: 'Asks for a price quotation', customer: 'SBI', subject: 'ATM e-surveillance RFQ' }) });
    expect(out).toMatchObject({ kind: 'rfq', door: 'rfp', confidence: 0.95 });
    const m = await classifyEmail(env, MSG, { fetch: chatReply({ kind: 'marketing', confidence: 0.9, reason: 'Vendor newsletter', customer: '', subject: 'Newsletter' }) });
    expect(m).toMatchObject({ kind: 'marketing', door: 'other' });
  });
});

describe('autopilot step', () => {
  it('without a proposal engine wired it records not_configured instead of faking a run', async () => {
    registerProposalRunner(null);
    await saveSettings(env, a.workspace, { enabled: true });
    await addIntake(a.workspace, 'intake_nc');
    const r = await autopilotStep(env, job(a.workspace, 'intake_nc', 'm-nc'), a.workspace, MSG, cls('rfq'));
    expect(r).toMatchObject({ action: 'proposal', status: 'not_configured', runId: null });
  });

  it('starts one proposal run for a confident RFQ and is idempotent per message', async () => {
    const started: ProposalRunInput[] = [];
    registerProposalRunner(async (_e, ws, input) => { started.push(input); expect(ws).toBe(a.workspace); return { runId: 'run_1', status: 'running' }; });
    await addIntake(a.workspace, 'intake_1');
    const r1 = await autopilotStep(env, job(a.workspace, 'intake_1', 'm-1'), a.workspace, MSG, cls('rfq'));
    const r2 = await autopilotStep(env, job(a.workspace, 'intake_1', 'm-1'), a.workspace, MSG, cls('rfq'));
    expect(r1).toMatchObject({ action: 'proposal', runId: 'run_1', status: 'running', duplicate: false });
    expect(r2).toMatchObject({ duplicate: true, runId: 'run_1' });
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ intakeId: 'intake_1', files: [{ filename: 'rfq.pdf', mimetype: 'application/pdf', r2Key: 'intakes/x/0-rfq.pdf' }] });
    expect(started[0]!.text).toContain('120 ATMs');
    expect(await env.DB.prepare("SELECT status FROM intakes WHERE id = 'intake_1'").first()).toMatchObject({ status: 'processing' });
  });

  it('marketing is ignored with its reason, stays visible in the Inbox and is never deleted', async () => {
    await addIntake(a.workspace, 'intake_mk');
    const r = await autopilotStep(env, job(a.workspace, 'intake_mk', 'm-mk'), a.workspace, { ...MSG, subject: 'Webinar' }, cls('marketing'));
    expect(r).toMatchObject({ action: 'ignored', runId: null });
    const inbox = (await (await call('/api/autopilot/inbox', a.cookie)).json()) as { items: { intake_id: string; action: string; reason: string; proposal: unknown }[] };
    expect(inbox.items.find((i) => i.intake_id === 'intake_mk')).toMatchObject({ action: 'ignored', reason: 'Looks like marketing', proposal: null });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM intakes WHERE id = 'intake_mk'").first()).toMatchObject({ n: 1 });
  });

  it('autopilot off and low confidence start nothing', async () => {
    await addIntake(b.workspace, 'intake_off');
    expect(await autopilotStep(env, job(b.workspace, 'intake_off', 'm-off'), b.workspace, MSG, cls('rfq'))).toMatchObject({ action: 'autopilot_off', runId: null });
    await saveSettings(env, b.workspace, { enabled: true });
    await addIntake(b.workspace, 'intake_low');
    expect(await autopilotStep(env, job(b.workspace, 'intake_low', 'm-low'), b.workspace, MSG, cls('rfp', 0.4))).toMatchObject({ action: 'needs_review', runId: null });
  });

  it('ignores uploads that carry no mailbox message id', async () => {
    expect(await autopilotStep(env, { intakeId: 'intake_up', workspaceId: a.workspace, source: 'upload' }, a.workspace, MSG, cls('rfq'))).toBeNull();
  });
});

describe('autopilot API and tenant isolation', () => {
  it('requires a session', async () => {
    expect((await call('/api/autopilot/status', '')).status).toBe(401);
    expect((await call('/api/autopilot', '', { method: 'PATCH', body: '{"enabled":true}' })).status).toBe(401);
  });
  it('PATCH toggles autopilot and validates input; status reports counts for the caller only', async () => {
    expect((await call('/api/autopilot', a.cookie, { method: 'PATCH', body: '{"threshold":5}' })).status).toBe(400);
    expect(await (await call('/api/autopilot', a.cookie, { method: 'PATCH', body: '{"enabled":false}' })).json()).toMatchObject({ enabled: false });
    const sa = (await (await call('/api/autopilot/status', a.cookie)).json()) as { enabled: boolean; counts: { received: number; ignored: number; proposals_started: number }; mailbox: { connected: boolean } };
    expect(sa).toMatchObject({ enabled: false, mailbox: { connected: false } });
    expect(sa.counts.ignored).toBe(1);
    expect(sa.counts.proposals_started).toBe(2);
    const ib = (await (await call('/api/autopilot/inbox', b.cookie)).json()) as { items: { intake_id: string }[] };
    expect(ib.items.map((i) => i.intake_id).sort()).toEqual(['intake_low', 'intake_off']);
  });
});

describe('tender fit evidence', () => {
  it('feeds the real catalogue SKUs into the fit prompt', async () => {
    await env.DB.prepare("INSERT INTO products (id, workspace_id, sku, name, family, specs_json, unit_price_minor, currency) VALUES ('p1', ?, 'RX-NVR-32', '32-channel NVR', 'Recorders', '{}', 4500000, 'INR')").bind(a.workspace).run();
    expect(await brainText(env, a.workspace)).toContain('[RX-NVR-32] 32-channel NVR (Recorders)');
    expect(await brainText(env, b.workspace)).toBe('');
  });
});

describe('prospects', () => {
  const search = {
    output: [
      { type: 'web_search_call', id: 'ws1', status: 'completed', results: [{ type: 'web_search_result', title: 'Bank expands', url: 'https://news.example/bank-expansion/', snippet: '..' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ prospects: [
        { org: 'Karnataka Gramin Bank', country: 'India', signal: 'Plans 300 new ATMs in FY27', source_url: 'https://news.example/bank-expansion', published_at: '2026-10-12', fit_reason: 'ATM surveillance fits [RX-NVR-32]', suggested_products: ['RX-NVR-32'], draft_outreach_email: 'Dear team, we noticed your ATM expansion plans and would like to propose surveillance.' },
        { org: 'Ghost Corp', country: 'India', signal: 'Rumoured expansion with no page behind it', source_url: 'https://invented.example/nothing', fit_reason: 'Looks plausible', suggested_products: [], draft_outreach_email: 'Dear Ghost Corp, we would love to work with you.' },
      ] }), annotations: [{ type: 'url_citation', url: 'https://news.example/bank-expansion/', title: 'Bank expands', start_index: 0, end_index: 5 }] }] },
    ],
  };
  const fetchStub = (async () => new Response(JSON.stringify({ id: 'resp_1', object: 'response', status: 'completed', ...search }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

  it('drops prospects whose source URL the search did not return', () => {
    const raw = [{ ...JSON.parse((search.output[1] as any).content[0].text).prospects[1] }, { org: 'No URL Ltd', signal: 'something happened here', source_url: '', fit_reason: 'fits well', draft_outreach_email: 'Dear all, hello there from us.' }]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(keepGrounded(raw, new Set([normUrl('https://news.example/bank-expansion')!]))).toMatchObject({ kept: [], dropped: 2 });
  });

  it('stores only grounded prospects per workspace, as drafts, and never leaks across tenants', async () => {
    await patchData(env.DB, a.workspace, { profile: { description: 'Rax Tech supplies e-surveillance and IoT for banks.', offerings: ['E-surveillance', 'IoT'] } });
    const r = await searchProspects(env, a.workspace, 'India', { fetch: fetchStub });
    expect(r.dropped_without_source).toBe(1);
    expect(r.prospects).toHaveLength(1);
    expect(r.prospects[0]).toMatchObject({ org: 'Karnataka Gramin Bank', source_url: 'https://news.example/bank-expansion', suggested_products: ['RX-NVR-32'] });
    await searchProspects(env, a.workspace, 'India', { fetch: fetchStub }); // same result again: no duplicate rows
    const mine = (await (await call('/api/prospects', a.cookie)).json()) as { items: { org: string }[] };
    expect(mine.items.map((p) => p.org)).toEqual(['Karnataka Gramin Bank']);
    expect(((await (await call('/api/prospects', b.cookie)).json()) as { items: unknown[] }).items).toEqual([]);
  });

  it('refuses a search before the company profile exists', async () => {
    await expect(searchProspects(env, b.workspace, undefined, { fetch: fetchStub })).rejects.toMatchObject({ code: 'company_incomplete' });
  });
});
