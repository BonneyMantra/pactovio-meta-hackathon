import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '@pactovio/contracts/env';
import { buildApp } from '../src/app';
import { makeEnv } from './helpers';
import { customerFixture } from './customer-fixture';

let env: Env, dispose: () => Promise<void>;
const { app } = buildApp();
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const ORIGIN = 'https://pactovio.example';
const call = (path: string, opts: { cookie?: string; body?: unknown; method?: string; origin?: string } = {}) =>
  app.fetch(new Request(`${ORIGIN}/api${path}`, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers: { origin: opts.origin ?? ORIGIN, cookie: opts.cookie ?? '', 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.40' },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  }), env, ctx);
let sent: any[] = [];
function mail(ok = true) {
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
    sent.push({ url: _url, headers: init.headers, ...JSON.parse(String(init.body)) });
    return Response.json(ok ? { id: 're_invite_1' } : { error: 'down' }, { status: ok ? 200 : 500 });
  }));
}
const pending = (ws: string, email: string) =>
  env.DB.prepare("SELECT * FROM workspace_invites WHERE workspace_id = ? AND email = ? AND status = 'pending'").bind(ws, email).all<any>();

async function owner() {
  const f = await customerFixture(env);
  await env.DB.prepare('UPDATE workspaces SET name = ? WHERE id = ?').bind('Rax Tech International', f.workspace).run();
  await env.DB.prepare('UPDATE customer_users SET email = ? WHERE id = ?').bind(`daniel-${f.user}@rax-tech.com`, f.user).run();
  return f;
}
async function otpLogin(address: string) {
  mail();
  expect((await call('/auth/code/request', { body: { email: address } })).status).toBe(202);
  const code = sent.at(-1).text.match(/\b\d{6}\b/)![0];
  const res = await call('/auth/code/verify', { body: { email: address, code } });
  expect(res.status).toBe(200);
  return await res.json() as any;
}

beforeAll(async () => {
  ({ env, dispose } = await makeEnv());
  env = { ...env, AUTH_SECRET: 'test-only-hmac-secret-at-least-32-characters', RESEND_API_KEY: 'transport-test', AUTH_EMAIL_FROM: 'Pactovio <login@pactovio.example>' };
}, 60000);
afterAll(async () => dispose?.());
afterEach(() => { vi.unstubAllGlobals(); sent = []; });

describe('team invites', () => {
  it('requires a session', async () => {
    expect((await call('/team')).status).toBe(401);
    expect((await call('/team/invites', { body: { email: 'reena@larinova.com' } })).status).toBe(401);
  });

  it('sends one Resend request and records a pending invite', async () => {
    mail();
    const f = await owner();
    const res = await call('/team/invites', { cookie: f.cookie, body: { email: '  Reena@Larinova.com ' } });
    expect(res.status).toBe(201);
    const { invite } = await res.json() as any;
    expect(invite).toMatchObject({ email: 'reena@larinova.com', status: 'pending' });
    expect(invite.id).toMatch(/^inv_/);
    expect(invite.invited_by_email).toContain('@rax-tech.com');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: 'https://api.resend.com/emails', from: 'Pactovio <login@pactovio.example>', to: ['reena@larinova.com'] });
    expect(sent[0].subject).toContain('invited you to Rax Tech International on Pactovio');
    expect(sent[0].html).toContain('Join Rax Tech International');
    expect(sent[0].html).toContain(`${'https://pactovio-meta.pages.dev'}/app`);
    const rows = (await pending(f.workspace, 'reena@larinova.com')).results;
    expect(rows).toHaveLength(1);
    expect(rows[0].resend_id).toBe('re_invite_1');
  });

  it('limits a re-invite to one per minute, then resends', async () => {
    mail();
    const f = await owner();
    const first = await call('/team/invites', { cookie: f.cookie, body: { email: 'reena@larinova.com' } });
    expect(first.status).toBe(201);
    const again = await call('/team/invites', { cookie: f.cookie, body: { email: 'reena@larinova.com' } });
    expect(again.status).toBe(429);
    expect(await again.json()).toMatchObject({ code: 'rate_limited', retry_after: expect.any(Number) });
    expect(sent).toHaveLength(1);
    await env.DB.prepare('UPDATE workspace_invites SET sent_at = ? WHERE workspace_id = ?').bind(new Date(Date.now() - 120000).toISOString(), f.workspace).run();
    const resend = await call('/team/invites', { cookie: f.cookie, body: { email: 'reena@larinova.com' } });
    expect(resend.status).toBe(200);
    expect(sent).toHaveLength(2);
    expect((await pending(f.workspace, 'reena@larinova.com')).results).toHaveLength(1);
  });

  it('rejects an existing member, invalid email and unknown fields', async () => {
    mail();
    const f = await owner();
    const me = await env.DB.prepare('SELECT email FROM customer_users WHERE id = ?').bind(f.user).first<{ email: string }>();
    const res = await call('/team/invites', { cookie: f.cookie, body: { email: me!.email.toUpperCase() } });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'already_member', error: 'That person is already on your team.' });
    expect((await call('/team/invites', { cookie: f.cookie, body: { email: 'not-an-email' } })).status).toBe(400);
    expect((await call('/team/invites', { cookie: f.cookie, body: { email: 'a@b.co', role: 'owner' } })).status).toBe(400);
    expect((await call('/team/invites', { cookie: f.cookie, body: { email: 'reena@larinova.com' }, origin: 'https://evil.example' })).status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it('delivery failure returns 503 and leaves no pending row', async () => {
    mail(false);
    const f = await owner();
    const res = await call('/team/invites', { cookie: f.cookie, body: { email: 'reena@larinova.com' } });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'delivery_unavailable', error: 'We could not send the invite right now. Try again in a little while.' });
    expect((await pending(f.workspace, 'reena@larinova.com')).results).toHaveLength(0);
  });

  it('is unavailable without delivery configuration', async () => {
    mail();
    const f = await owner();
    const saved = env;
    env = { ...env, RESEND_API_KEY: '' };
    const res = await call('/team/invites', { cookie: f.cookie, body: { email: 'reena@larinova.com' } });
    env = saved;
    expect(res.status).toBe(503);
    expect(sent).toHaveLength(0);
  });

  it('cannot revoke another workspace invite; owner can revoke their own', async () => {
    mail();
    const a = await owner(), b = await owner();
    const { invite } = await (await call('/team/invites', { cookie: a.cookie, body: { email: 'reena@larinova.com' } })).json() as any;
    expect((await call(`/team/invites/${invite.id}`, { cookie: b.cookie, method: 'DELETE' })).status).toBe(404);
    expect((await pending(a.workspace, 'reena@larinova.com')).results).toHaveLength(1);
    const ok = await call(`/team/invites/${invite.id}`, { cookie: a.cookie, method: 'DELETE' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect((await call(`/team/invites/${invite.id}`, { cookie: a.cookie, method: 'DELETE' })).status).toBe(404);
  });

  it('lists members and pending invites for the session workspace only', async () => {
    mail();
    const a = await owner(), b = await owner();
    await call('/team/invites', { cookie: a.cookie, body: { email: 'reena@larinova.com' } });
    await call('/team/invites', { cookie: b.cookie, body: { email: 'sam@other-co.com' } });
    const list = await (await call('/team', { cookie: a.cookie })).json() as any;
    expect(list.members).toHaveLength(1);
    expect(list.members[0]).toMatchObject({ user_id: a.user, role: 'owner', you: true });
    expect(list.invites.map((i: any) => i.email)).toEqual(['reena@larinova.com']);
    expect(list.invites[0]).toHaveProperty('invited_at');
  });

  it('a brand-new invited email joins the inviting workspace as a member on OTP sign-in', async () => {
    mail();
    const f = await owner();
    const { invite } = await (await call('/team/invites', { cookie: f.cookie, body: { email: 'reena@larinova.com' } })).json() as any;
    const session = await otpLogin('reena@larinova.com');
    expect(session.workspace_id).toBe(f.workspace);
    const m = await env.DB.prepare('SELECT m.role FROM workspace_members m JOIN customer_users u ON u.id = m.user_id WHERE u.email = ?').bind('reena@larinova.com').first<any>();
    expect(m.role).toBe('member');
    const row = await env.DB.prepare('SELECT status, accepted_at FROM workspace_invites WHERE id = ?').bind(invite.id).first<any>();
    expect(row.status).toBe('accepted'); expect(row.accepted_at).toBeTruthy();
    const list = await (await call('/team', { cookie: f.cookie })).json() as any;
    expect(list.members.map((x: any) => x.role)).toEqual(['owner', 'member']);
    expect(list.invites).toHaveLength(0);
  });

  it('an invited email that already has an account keeps its own workspace', async () => {
    mail();
    const f = await owner();
    const own = await otpLogin('priya@larinova.com');
    await call('/team/invites', { cookie: f.cookie, body: { email: 'priya@larinova.com' } });
    await env.DB.prepare('DELETE FROM email_codes WHERE email = ?').bind('priya@larinova.com').run();
    const again = await otpLogin('priya@larinova.com');
    expect(again.workspace_id).toBe(own.workspace_id);
    expect(again.workspace_id).not.toBe(f.workspace);
    expect((await pending(f.workspace, 'priya@larinova.com')).results).toHaveLength(1);
  });

  it('ignores invites older than 14 days', async () => {
    mail();
    const f = await owner();
    await call('/team/invites', { cookie: f.cookie, body: { email: 'old@larinova.com' } });
    await env.DB.prepare('UPDATE workspace_invites SET created_at = ? WHERE email = ?').bind(new Date(Date.now() - 15 * 86400000).toISOString(), 'old@larinova.com').run();
    const session = await otpLogin('old@larinova.com');
    expect(session.workspace_id).not.toBe(f.workspace);
  });
});
