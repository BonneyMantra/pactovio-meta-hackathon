import { Hono } from 'hono';
import { z } from 'zod';
import { takeLimit } from '../lib/customer-security';
import { listProspects, searchProspects } from '../lib/prospects';
import { authed, jsonBody } from '../lib/route-auth';
import type { AppEnv } from '../lib/types';

const Search = z.object({ focus: z.string().trim().max(200).optional() });

/** /api/prospects: buyers with public buying signals, found by Muse Spark web search. Outreach emails are drafts only; nothing is ever sent. */
export const prospectRoutes = new Hono<AppEnv>();

prospectRoutes.post('/search', authed(async (c, ws) => {
  const { focus } = await jsonBody(c, (v) => Search.parse(v));
  await takeLimit(c.env.DB, `prospects-search:${ws}`, 10, 3600);
  return c.json(await searchProspects(c.env, ws, focus || undefined));
}));

prospectRoutes.get('/', authed(async (c, ws) => c.json({ items: await listProspects(c.env, ws) })));
