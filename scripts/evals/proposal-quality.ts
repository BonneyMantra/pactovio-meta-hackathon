/**
 * Proposal quality eval. Usage:
 *   npx tsx scripts/evals/proposal-quality.ts --snapshot <file> --out <json>
 * snapshot: {exported_at, proposals:[{id, workspace_id, created_at, source, cost_usd, proposal_json, state_json}],
 * workspaces:{[id]:{catalogue, brain:{style_json}, learned:[{proposal_json}], outcomes}}} exported read-only from D1.
 * The committed output holds ids (suffix), numbers and check scores, never document text.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { aggregateProposals, scoreProposal, CHECK_NAMES, type PastProposal, type ProposalLike, type ProposalScore, type ScoreCtx } from '../../packages/evals/src/proposal-score';

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v) throw new Error(`missing --${name}`);
  return v;
}
const parse = <T>(s: string | null | undefined): T | null => { try { return s ? (JSON.parse(s) as T) : null; } catch { return null; } };

interface Ws { catalogue: ScoreCtx['catalogue']; brain: { style_json: string | null } | null; learned: { proposal_ref: string | null; proposal_json: string | null }[]; outcomes: ScoreCtx['outcomes'] }
interface Row { id: string; workspace_id: string; created_at: string; source: string; cost_usd: number; proposal_json: string; state_json: string }
type Learned = { ref?: string; solution_type?: string; commercials?: { total_inr?: number }; outcome?: { status?: 'won' | 'lost' | 'pending' } };
type State = { rfq?: { requirements?: ScoreCtx['requirements'] }; claims?: { checked: number; supported: number } };

const snap = JSON.parse(readFileSync(arg('snapshot'), 'utf8')) as { exported_at: string; proposals: Row[]; workspaces: Record<string, Ws> };
const round = (n: number): number => Math.round(n * 10000) / 10000;

const results = snap.proposals.map((row) => {
  const p = JSON.parse(row.proposal_json) as ProposalLike & { client: { name: string }; commercials: { total_inr: number } };
  const ws = snap.workspaces[row.workspace_id]!;
  const state = parse<State>(row.state_json);
  const past: PastProposal[] = ws.learned.map((l) => {
    const j = parse<Learned>(l.proposal_json);
    return { ref: j?.ref ?? l.proposal_ref ?? '', solution_type: j?.solution_type, total_inr: j?.commercials?.total_inr, outcome: j?.outcome?.status };
  }).filter((x) => x.ref);
  const ctx: ScoreCtx = {
    catalogue: ws.catalogue, pastProposals: past, outcomes: ws.outcomes, style: parse(ws.brain?.style_json),
    requirements: state?.rfq?.requirements, claimStats: state?.claims ?? null,
  };
  const score: ProposalScore = scoreProposal(p, ctx);
  const nonInr = ws.catalogue.filter((c) => c.currency && c.currency !== 'INR').length;
  return {
    id: row.id.slice(-8), created_at: row.created_at, source: row.source, client: p.client.name, cost_usd: round(row.cost_usd),
    numbers: {
      total_inr: p.commercials.total_inr, bom_lines: p.scope_of_supply?.length ?? 0, requirements: ctx.requirements?.length ?? 0,
      evidence: p.evidence?.length ?? 0, compliance_rows: p.compliance?.length ?? 0, catalogue_size: ws.catalogue.length,
      learned_pool: past.length, outcomes_known: ws.outcomes.length, catalogue_non_inr: nonInr,
    },
    overall: score.overall, checks: score.checks,
  };
});

const hero = results.filter((r) => /kurinji/i.test(r.client));
const agg = (rs: typeof results) => aggregateProposals(rs.map((r) => ({ checks: r.checks, overall: r.overall })));
const out = {
  generated_at: new Date().toISOString(), snapshot_exported_at: snap.exported_at, proposals: results.length,
  hero_rfp: 'Kurinji Commercial Bank', hero_proposals: hero.length,
  aggregate_all: agg(results), aggregate_hero: hero.length ? agg(hero) : null, results,
};
writeFileSync(arg('out'), JSON.stringify(out, null, 2) + '\n');

const f = (n: number | null): string => (n === null ? '  -  ' : n.toFixed(2));
const a = out.aggregate_all, h = out.aggregate_hero;
const lines = [`| check | n | mean | min | max | hero mean (n) |`, `|---|---|---|---|---|---|`];
for (const k of ['overall', ...CHECK_NAMES] as const) {
  const s = k === 'overall' ? a.overall : a.checks[k], hs = h ? (k === 'overall' ? h.overall : h.checks[k]) : null;
  lines.push(`| ${k} | ${s.n} | ${f(s.mean)} | ${f(s.min)} | ${f(s.max)} | ${hs ? `${f(hs.mean)} (${hs.n})` : '-'} |`);
}
process.stdout.write(`${lines.join('\n')}\n`);
