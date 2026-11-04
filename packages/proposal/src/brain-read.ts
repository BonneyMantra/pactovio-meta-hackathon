import type { BrainData, BrainStyle, CompanyBrain, PastProposal } from './brain';
import { selfStatements } from './brain-facts';

/** The subset of a learned past proposal (B1's brain_documents.proposal_json) the bid engine uses. */
interface LearnedProposal {
  ref?: string; title?: string; date?: string; validity_days?: number; solution_type?: string; executive_summary?: string;
  client?: { name?: string; sector?: string; city?: string };
  scope_of_supply?: { sku?: string }[];
  custom_engineering?: { work_package?: string; description?: string; rate_inr?: number }[];
  commercials?: { total_inr?: number };
  warranty_amc?: { warranty_months_from_commissioning?: number; warranty_months_from_dispatch?: number };
  outcome?: { status?: 'won' | 'lost' | 'pending' };
  prepared_by?: { name?: string; title?: string };
}
interface StoredStyle {
  section_order?: string[]; voice_rules?: { id: string; text: string }[]; phrases?: { text: string }[];
  payment_terms?: string; warranty?: string; amc_pct?: number; validity_days?: number; discount_pattern?: string;
}

const parse = <T>(s: string | null | undefined): T | null => { if (!s) return null; try { return JSON.parse(s) as T; } catch { return null; } };
const nums = (xs: (number | undefined)[]): number[] => xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0);
function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1]! + s[m]!) / 2);
}
function mode<T>(xs: T[], key: (x: T) => string): T | undefined {
  const c = new Map<string, { n: number; x: T }>();
  for (const x of xs) { const k = key(x); const e = c.get(k); c.set(k, { n: (e?.n ?? 0) + 1, x }); }
  return [...c.values()].sort((a, b) => b.n - a.n)[0]?.x;
}

/** Day rates the company actually quoted, by kind of work (firmware vs software vs other). */
function rates(ps: LearnedProposal[]): BrainStyle['engineering_rates_inr'] {
  const wps = ps.flatMap((p) => p.custom_engineering ?? []);
  const kind = (w: { work_package?: string; description?: string }) => `${w.work_package ?? ''} ${w.description ?? ''}`.toLowerCase();
  const fw = median(nums(wps.filter((w) => /firmware|embedded|panel|controller/.test(kind(w))).map((w) => w.rate_inr)));
  const sw = median(nums(wps.filter((w) => /software|integration|api|dashboard|portal|cms/.test(kind(w))).map((w) => w.rate_inr)));
  const all = median(nums(wps.map((w) => w.rate_inr)));
  return all ? { firmware: fw ?? all, software: sw ?? all, default: all } : undefined;
}

/** Fold B1's style profile and the learned documents into the style the bid engine applies. */
export function toStyle(stored: StoredStyle | null, ps: LearnedProposal[]): BrainStyle | undefined {
  if (!stored && !ps.length) return undefined;
  const w = mode(ps.map((p) => p.warranty_amc).filter(Boolean) as NonNullable<LearnedProposal['warranty_amc']>[], (x) => `${x.warranty_months_from_commissioning}|${x.warranty_months_from_dispatch}`);
  const by = mode(ps.map((p) => p.prepared_by).filter((x): x is { name: string; title: string } => !!x?.name && !!x?.title), (x) => `${x.name}|${x.title}`);
  const rules = stored?.voice_rules ?? [];
  const s: BrainStyle = {
    section_order: stored?.section_order?.length ? stored.section_order : undefined,
    voice_rules: rules.length ? rules.map((r) => `${r.id}: ${r.text}`) : undefined,
    voice_rule_ids: rules.length ? rules.map((r) => r.id) : undefined,
    phrases: stored?.phrases?.length ? stored.phrases.map((p) => p.text) : undefined,
    payment_terms: stored?.payment_terms || undefined, warranty: stored?.warranty || undefined,
    amc_pct: stored?.amc_pct || undefined, validity_days: stored?.validity_days || median(nums(ps.map((p) => p.validity_days))),
    discount_pattern: stored?.discount_pattern || undefined,
    warranty_months_commissioning: w?.warranty_months_from_commissioning, warranty_months_dispatch: w?.warranty_months_from_dispatch,
    engineering_rates_inr: rates(ps), prepared_by: by,
  };
  return Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as BrainStyle;
}

export function toPast(p: LearnedProposal, outcome?: 'won' | 'lost' | 'pending'): PastProposal | null {
  if (!p.ref || !p.title) return null;
  return {
    ref: p.ref, title: p.title, solution_type: p.solution_type ?? 'own_products', sector: p.client?.sector, client: p.client?.name, city: p.client?.city, date: p.date,
    total_inr: p.commercials?.total_inr, skus: (p.scope_of_supply ?? []).map((l) => l.sku ?? '').filter(Boolean), outcome: outcome ?? p.outcome?.status,
    summary: p.executive_summary?.slice(0, 400),
  };
}

export async function readBrainTables(db: D1Database, ws: string): Promise<BrainData> {
  const [row, wsRow, docs, outs] = await Promise.all([
    db.prepare('SELECT style_json, stats_json, proposals_learned, learned_at FROM company_brain WHERE workspace_id = ?').bind(ws)
      .first<{ style_json: string | null; stats_json: string | null; proposals_learned: number; learned_at: string | null }>(),
    db.prepare('SELECT name, profile_json FROM workspaces WHERE id = ?').bind(ws).first<{ name: string | null; profile_json: string | null }>(),
    db.prepare("SELECT proposal_json FROM brain_documents WHERE workspace_id = ? AND status = 'done' AND proposal_json IS NOT NULL ORDER BY updated_at LIMIT 300").bind(ws).all<{ proposal_json: string }>(),
    db.prepare('SELECT ref, status FROM brain_outcomes WHERE workspace_id = ?').bind(ws).all<{ ref: string; status: 'won' | 'lost' | 'pending' }>().catch(() => ({ results: [] as { ref: string; status: 'won' | 'lost' | 'pending' }[] })),
  ]);
  const byRef = new Map<string, LearnedProposal>();
  for (const d of docs.results) { const p = parse<LearnedProposal>(d.proposal_json); if (p?.ref) byRef.set(p.ref, p); }
  const outcome = new Map(outs.results.map((o) => [o.ref, o.status]));
  const learned = [...byRef.values()];
  const past = learned.map((p) => toPast(p, outcome.get(p.ref!))).filter((p): p is PastProposal => !!p);
  const profile = parse<Record<string, unknown>>(wsRow?.profile_json) ?? {};
  const style = toStyle(parse<StoredStyle>(row?.style_json), learned);
  if (!row && !learned.length) return { brain: Object.keys(profile).length ? { profile: withName(profile, wsRow?.name) } : null, past };
  const brain: CompanyBrain = {
    profile: withName(profile, wsRow?.name), proposals_learned: row?.proposals_learned ?? learned.length,
    style, stats: parse<Record<string, unknown>>(row?.stats_json) ?? undefined, learned_at: row?.learned_at ?? undefined,
    self_statements: selfStatements(learned as Record<string, unknown>[]),
  };
  return { brain, past };
}

function withName(profile: Record<string, unknown>, wsName: string | null | undefined): CompanyBrain['profile'] {
  const legal = (profile.legal_name ?? profile.name ?? profile.company_name ?? wsName) as string | undefined;
  return { ...profile, legal_name: legal ?? undefined };
}
