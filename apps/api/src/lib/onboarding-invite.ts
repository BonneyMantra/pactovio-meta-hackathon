import { escapeHtml } from './otp-email';
import { nowIso, randomToken } from './db';

const ACCENT = '#f2600c';
const INK = '#1f1d1a';
const MUTED = '#6b655d';
const PAPER = '#faf8f5';
const INVITE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export interface InviteEmail { subject: string; text: string; html: string }

/** Team invite email: same table layout and inline styles as the sign-in code email. */
export function inviteEmail(opts: { company: string; inviter: string; joinUrl: string }): InviteEmail {
  const { company, inviter, joinUrl } = opts;
  const subject = `${inviter} invited you to ${company} on Pactovio`;
  const text = [
    `${inviter} invited you to join ${company} on Pactovio.`,
    `Pactovio is the agent that writes ${company}'s proposals.`,
    `Join ${company}: ${joinUrl}`,
    'Sign in with this email address to join.',
    'If you were not expecting this invite, you can ignore this email.',
    '',
    `Pactovio - ${new URL(joinUrl).host}`,
  ].join('\n');
  const font = "font-family:'Mona Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const co = escapeHtml(company), who = escapeHtml(inviter), url = escapeHtml(joinUrl);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${who} invited you to join ${co} on Pactovio.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:#ffffff;border:1px solid #ece7e0;border-radius:14px;">
<tr><td style="padding:32px 32px 8px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="28" height="28" style="width:28px;height:28px;background:${ACCENT};border-radius:7px;color:#ffffff;${font};font-size:16px;font-weight:700;text-align:center;line-height:28px;">P</td>
<td style="padding-left:10px;${font};font-size:18px;font-weight:700;color:${INK};letter-spacing:-0.2px;">Pactovio</td>
</tr></table></td></tr>
<tr><td style="padding:24px 32px 0 32px;${font};font-size:20px;font-weight:600;color:${INK};line-height:28px;">Join ${co} on Pactovio</td></tr>
<tr><td style="padding:8px 32px 0 32px;${font};font-size:15px;color:${MUTED};line-height:22px;"><span style="color:${INK};">${who}</span> invited you to join ${co}. Pactovio is the agent that writes ${co}'s proposals.</td></tr>
<tr><td style="padding:24px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background:${ACCENT};border-radius:10px;"><a href="${url}" style="display:inline-block;padding:13px 22px;${font};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Join ${co}</a></td>
</tr></table></td></tr>
<tr><td style="padding:0 32px;${font};font-size:14px;color:${MUTED};line-height:21px;">Sign in with this email address to join.</td></tr>
<tr><td style="padding:12px 32px 32px 32px;${font};font-size:14px;color:${MUTED};line-height:21px;">If you weren't expecting this invite, you can safely ignore this email.</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
<tr><td align="center" style="padding:20px 16px;${font};font-size:12px;color:${MUTED};line-height:18px;">Pactovio &middot; <a href="${escapeHtml(new URL(joinUrl).origin)}" style="color:${MUTED};text-decoration:underline;">${escapeHtml(new URL(joinUrl).host)}</a></td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject, text, html };
}

/**
 * A brand-new email with a pending invite (under 14 days old) joins the inviting workspace as a member.
 * Emails that already have an account are left alone. Returns the workspace id, or null.
 */
export async function acceptPendingInvite(db: D1Database, email: string): Promise<string | null> {
  const existing = await db.prepare('SELECT id FROM customer_users WHERE email = ?').bind(email).first();
  if (existing) return null;
  const since = new Date(Date.now() - INVITE_WINDOW_MS).toISOString();
  const invite = await db.prepare(`SELECT i.id, i.workspace_id FROM workspace_invites i
    JOIN workspaces w ON w.id = i.workspace_id AND w.sample = 0
    WHERE i.email = ? AND i.status = 'pending' AND i.created_at >= ? ORDER BY i.created_at DESC LIMIT 1`)
    .bind(email, since).first<{ id: string; workspace_id: string }>();
  if (!invite) return null;
  const user = `usr_${randomToken(16)}`, at = nowIso();
  await db.batch([
    db.prepare('INSERT INTO customer_users (id, email, workspace_id, verified_at) VALUES (?, ?, ?, ?)').bind(user, email, invite.workspace_id, at),
    db.prepare("INSERT INTO workspace_members (user_id, workspace_id, role) VALUES (?, ?, 'member')").bind(user, invite.workspace_id),
    db.prepare("UPDATE workspace_invites SET status = 'accepted', accepted_at = ? WHERE id = ? AND status = 'pending'").bind(at, invite.id),
  ]);
  return invite.workspace_id;
}
