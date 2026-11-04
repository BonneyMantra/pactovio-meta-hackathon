import { describe, expect, it } from 'vitest';
import { safeReturn } from '../src/identity';

describe('safeReturn', () => {
  it('keeps the fixed in-app return screens', () => {
    for (const to of ['/app#/onboarding', '/app#/team', '/app#/inbox', '/app#/brain/learning']) expect(safeReturn(to)).toBe(to);
  });
  it('sends anything else to Connections', () => {
    for (const to of [undefined, '', 'https://evil.example/app#/team', '//evil.example', '/app#/team?x=1', '/app#/teams', 'javascript:alert(1)']) expect(safeReturn(to)).toBe('/app#/connections');
  });
});
