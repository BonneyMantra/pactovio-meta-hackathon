import { describe, expect, it } from 'vitest';
import { selfStatements } from '../../../packages/proposal/src/brain-facts';

describe('self statements from learned proposals', () => {
  it('merges variants of the same statement, counts proposals once each, and ignores text about the client', () => {
    const learned = [
      { executive_summary: 'Thank you for the opportunity. The panels are designed and manufactured in-house at our Chennai facility.', assumptions: ['Client provides power at each site.'] },
      { executive_summary: 'All Rax products are designed and manufactured in-house at our Chennai facility. Hardware is designed and manufactured in-house at our Chennai facility.' },
      { solution_overview: 'Rax prepares the site survey drawings remotely and supervises installation by video.', exclusions: ['Civil works at the client facility.'] },
    ];
    const s = selfStatements(learned);
    expect(s[0]).toMatch(/in-house at our Chennai facility\. \(in 2 past proposals\)$/);
    expect(s.some((x) => /supervises installation by video/.test(x))).toBe(true);
    expect(s.some((x) => /client facility/.test(x))).toBe(false);
  });
});
