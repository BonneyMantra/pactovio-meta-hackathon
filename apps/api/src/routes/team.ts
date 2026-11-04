import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { CustomerEmail, HttpError } from '@pactovio/contracts';
import { customerAuth } from '../lib/customer-session';
import { takeLimit } from '../lib/customer-security';
import { exec, nowIso, randomToken } from '../lib/db';
import { inviteEmail } from '../lib/onboarding-invite';
import type { AppEnv } from '../lib/types';

export const teamRoutes = new Hono<AppEnv>();
teamRoutes.use('*', async (c, next) => {
  c.header('cache-control', 'no-store');
  c.set('auth', await customerAuth(c));
  await next();
});

const InviteBody = z.object({ email: CustomerEmail }).strict();
const DEFAULT_ORIGIN = 'https://pactovio-meta.pages.dev';
const RESEND_GAP_MS = 60000;

interface InviteRow { id: string; email: string; status: string; invited_at: string; sent_at: string | null; invited_by_email: string | null }
const INVITE_SELECT = `SELECT i.id, i.email, i.status, i.created_at AS invited_at, i.sent_at, u.email AS invited_by_email
  FROM workspace_invites i LEFT JOIN customer_users u ON u.id = i.invited_by`;

/** Only our own app origins may appear in the email link. */
function joinOrigin(c: Context<AppEnv>): string {
  const origin = c.req.header('origin') ?? '';
  const ok = origin === DEFAULT_ORIGIN || /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.pactovio-meta\.pages\.dev$/.test(origin)
    || /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/.test(origin);
  return ok ? origin : DEFAULT_ORIGIN;
}

async function getInvite(db: D1Database, id: string): Promise<InviteRow> {
  const row = await db.prepare(`${INVITE_SELECT} WHERE i.id = ?`).bind(id).first<InviteRow>();
  if (!row) throw new HttpError(404, 'Invite not found', 'not_found');
  return row;
}

teamRoutes.get('/', async (c) => {
  const { workspaceId, userId } = c.get('auth'), db = c.env.DB;
  const members = await db.prepare(`SELECT u.id AS user_id, u.email, m.role FROM workspace_members m
    JOIN customer_users u ON u.id = m.user_id WHERE m.workspace_id = ?
    ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, u.email`).bind(workspaceId).all<{ user_id: string; email: string; role: string }>();
  const invites = await db.prepare(`${INVITE_SELECT} WHERE i.workspace_id = ? AND i.status = 'pending' ORDER BY i.created_at DESC, i.id`)
    .bind(workspaceId).all<InviteRow>();
  return c.json({ members: members.results.map((m) => ({ ...m, you: m.user_id === userId })), invites: invites.results });
});

teamRoutes.post('/invites', async (c) => {
  const { email } = InviteBody.parse(await c.req.json().catch(() => ({})));
  const { workspaceId, userId } = c.get('auth'), db = c.env.DB;
  if (!c.env.RESEND_API_KEY || !c.env.AUTH_EMAIL_FROM) throw new HttpError(503, 'Invites are not configured', 'delivery_unavailable');
  const member = await db.prepare(`SELECT 1 AS x FROM workspace_members m JOIN customer_users u ON u.id = m.user_id
    WHERE m.workspace_id = ? AND u.email = ?`).bind(workspaceId, email).first();
  if (member) throw new HttpError(409, 'That person is already on your team.', 'already_member');

  const now = Date.now(), sentAt = new Date(now).toISOString();
  const existing = await db.prepare("SELECT id, sent_at FROM workspace_invites WHERE workspace_id = ? AND email = ? AND status = 'pending'")
    .bind(workspaceId, email).first<{ id: string; sent_at: string | null }>();
  let id: string, previousSent: string | null = null, fresh = false;
  if (existing) {
    id = existing.id; previousSent = existing.sent_at;
    const gate = new Date(now - RESEND_GAP_MS).toISOString();
    const claimed = await db.prepare("UPDATE workspace_invites SET sent_at = ? WHERE id = ? AND status = 'pending' AND (sent_at IS NULL OR sent_at <= ?) RETURNING id")
      .bind(sentAt, id, gate).first();
    if (!claimed) {
      const wait = previousSent ? Math.max(1, Math.ceil((Date.parse(previousSent) + RESEND_GAP_MS - now) / 1000)) : 60;
      throw new HttpError(429, 'That invite was just sent. Wait a minute before sending it again.', 'rate_limited', { retry_after: wait });
    }
  } else {
    await takeLimit(db, `invite:ws:${workspaceId}`, 20, 3600);
    id = `inv_${randomToken(16)}`; fresh = true;
    await db.prepare('INSERT INTO workspace_invites (id, workspace_id, email, invited_by, status, created_at, sent_at) VALUES (?, ?, ?, ?, \'pending\', ?, ?)')
      .bind(id, workspaceId, email, userId, sentAt, sentAt).run();
  }

  const ws = await db.prepare('SELECT name FROM workspaces WHERE id = ?').bind(workspaceId).first<{ name: string }>();
  const inviter = await db.prepare('SELECT email FROM customer_users WHERE id = ?').bind(userId).first<{ email: string }>();
  const name = ws?.name?.trim();
  const company = !name || name === 'Your company' ? 'your company' : name;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { authorization: `Bearer ${c.env.RESEND_API_KEY}`, 'content-type': 'application/json', 'idempotency-key': `invite-${id}-${now}` },
      body: JSON.stringify({ from: c.env.AUTH_EMAIL_FROM, to: [email], ...inviteEmail({ company, inviter: inviter?.email ?? 'A colleague', joinUrl: `${joinOrigin(c)}/app` }) }),
    });
    if (!response.ok) throw new Error('delivery failed');
    const receipt = await response.json() as { id?: unknown };
    if (typeof receipt.id !== 'string') throw new Error('delivery failed');
    await exec(db, 'UPDATE workspace_invites SET resend_id = ? WHERE id = ?', receipt.id, id);
  } catch {
    if (fresh) await exec(db, "DELETE FROM workspace_invites WHERE id = ? AND status = 'pending'", id);
    else await exec(db, 'UPDATE workspace_invites SET sent_at = ? WHERE id = ?', previousSent, id);
    throw new HttpError(503, 'We could not send the invite right now. Try again in a little while.', 'delivery_unavailable');
  }
  return c.json({ invite: await getInvite(db, id) }, fresh ? 201 : 200);
});

teamRoutes.delete('/invites/:id', async (c) => {
  const { workspaceId } = c.get('auth');
  const row = await c.env.DB.prepare("UPDATE workspace_invites SET status = 'revoked' WHERE id = ? AND workspace_id = ? AND status = 'pending' RETURNING id")
    .bind(c.req.param('id'), workspaceId).first();
  if (!row) throw new HttpError(404, 'Invite not found', 'not_found');
  return c.json({ ok: true });
});
