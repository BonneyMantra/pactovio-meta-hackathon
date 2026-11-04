import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RfqRead } from '../../../packages/proposal/src/schema';
import { SelectionModel } from '../../../packages/proposal/src/select';
import { NarrativeModel } from '../../../packages/proposal/src/bom';
import { DesignModel } from '../../../packages/proposal/src/design';
import { ComplianceModel } from '../../../packages/proposal/src/compliance';
import { PlaceModel } from '../../../packages/proposal/src/place';

/** Meta strict structured output rejects any object whose properties are not all listed in `required` (400 at run time). */
function optionalPaths(node: unknown, path = '$'): string[] {
  if (!node || typeof node !== 'object') return [];
  const n = node as Record<string, unknown>;
  const out: string[] = [];
  if (n.type === 'object' && n.properties) {
    const req = new Set((n.required as string[] | undefined) ?? []);
    for (const k of Object.keys(n.properties as object)) if (!req.has(k)) out.push(`${path}.${k}`);
  }
  for (const [k, v] of Object.entries(n)) {
    if (Array.isArray(v)) v.forEach((x, i) => out.push(...optionalPaths(x, `${path}.${k}[${i}]`)));
    else if (v && typeof v === 'object') out.push(...optionalPaths(v, k === 'properties' ? path : `${path}.${k}`));
  }
  return out;
}

describe('model-facing schemas are valid for strict structured output', () => {
  it('catches an optional property (the zone_map.site regression)', () => {
    const bad = z.object({ zone_map: z.array(z.object({ site: z.string().optional(), zone: z.string() })) });
    expect(optionalPaths(z.toJSONSchema(bad, { target: 'draft-7', unrepresentable: 'any' })).join()).toContain('site');
  });
  const schemas = { RfqRead, SelectionModel, NarrativeModel, DesignModel, ComplianceModel, PlaceModel };
  for (const [name, s] of Object.entries(schemas)) {
    it(`${name} has no optional properties`, () => {
      expect(optionalPaths(z.toJSONSchema(s, { target: 'draft-7', unrepresentable: 'any' }))).toEqual([]);
    });
  }
});
