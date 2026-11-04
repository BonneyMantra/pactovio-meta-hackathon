import { describe, expect, it } from 'vitest';
import { fitTerms } from '../src/lib/opportunity-search';
import type { OnboardingState } from '../src/lib/onboarding-state';

const state = (brainText?: string) => ({
  company: { capabilities: ['Hardware Design & PCB Layout', 'FPGA Design Services'] }, profile: { offerings: [] }, brainText,
}) as unknown as OnboardingState & { brainText?: string };

describe('tender ranking terms', () => {
  it('adds the real catalogue and brain vocabulary to the confirmed capabilities', () => {
    const t = fitTerms(state('Catalogue (67 products, first 40): [RX-SOS-200] SOS Alarm Panel (Intrusion); [RX-VS-16] Video Surveillance Gateway (CCTV).\nSectors served: banking (12).'));
    expect(t).toEqual(expect.arrayContaining(['fpga', 'alarm', 'intrusion', 'surveillance', 'video', 'banking']));
  });
  it('drops SKU codes, numbers and the brain text framing words', () => {
    const t = fitTerms(state('Catalogue (67 products, first 40): [RX-SOS-200] Siren. Company Brain: learned from 9 past proposals, win rate 40%.'));
    for (const bad of ['catalogue', 'first', 'learned', 'proposals', 'rx-sos-200', 'sos', '200']) expect(t).not.toContain(bad);
    expect(t).toContain('siren');
  });
  it('without a brain falls back to capabilities only', () => {
    expect(fitTerms(state())).toEqual(expect.arrayContaining(['fpga', 'layout']));
  });
});
