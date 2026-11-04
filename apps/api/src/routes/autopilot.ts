import { Hono } from 'hono';
import { z } from 'zod';
import { getConnector, isLive } from '@pactovio/connectors';
import { DEFAULT_THRESHOLD, getSettings, inboxCounts, listInbox, saveSettings } from '../lib/autopilot-store';
import { authed, jsonBody } from '../lib/route-auth';
import type { AppEnv } from '../lib/types';

const Patch = z.object({ enabled: z.boolean().optional(), threshold: z.number().min(0.3).max(0.99).optional() })
  .refine((v) => v.enabled !== undefined || v.threshold !== undefined, 'Send enabled and/or threshold');

/** /api/autopilot: Gmail autopilot settings, status and the classified Inbox (customer session; every query scoped to the session workspace). */
export const autopilotRoutes = new Hono<AppEnv>();

autopilotRoutes.get('/status', authed(async (c, ws) => {
  const env = c.env;
  const [settings, gmail, counts] = await Promise.all([getSettings(env, ws), getConnector(env, ws, 'gmail'), inboxCounts(env, ws)]);
  const connected = isLive(gmail);
  const mail = gmail;
  return c.json({
    enabled: settings.enabled, threshold: settings.threshold ?? DEFAULT_THRESHOLD, last_checked_at: settings.last_checked_at,
    mailbox: { provider: 'gmail', connected, connected_at: connected ? mail!.connected_at : null, status: mail?.status ?? 'available',
      delivery: mail?.meta.config?.trigger ? 'trigger' : connected ? 'poll' : null },
    counts,
  });
}));

autopilotRoutes.patch('/', authed(async (c, ws) => {
  const p = await jsonBody(c, (v) => Patch.parse(v));
  const s = await saveSettings(c.env, ws, p);
  return c.json({ enabled: s.enabled, threshold: s.threshold });
}));

autopilotRoutes.get('/inbox', authed(async (c, ws) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 100);
  return c.json({ items: await listInbox(c.env, ws, limit) });
}));
