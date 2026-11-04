import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectWav, parseSamOutput, sseTextDeltas, transcriptText } from '../src';

const fixture = readFileSync(resolve(__dirname, '../../../fixtures/proposal/sam-rectangle-hero.sse'), 'utf8');

describe('SAM output parsing (recorded live response, sam-3.1, concept "rectangle", 2400x1700 plan)', () => {
  const det = parseSamOutput(sseTextDeltas(fixture));
  it('reads every record with normalised boxes inside 0..1', () => {
    expect(det.length).toBe(28);
    for (const d of det) { expect(d.frame).toBe(0); expect(d.size).toEqual({ w: 2400, h: 1700 }); for (const v of d.box) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); } }
  });
  it('first record matches the wire text', () => {
    expect(det[0]!.px).toEqual({ x1: 998, y1: 948, x2: 1062, y2: 1001 });
    expect(det[0]!.box).toEqual([0.4158, 0.5576, 0.0271, 0.0318]);
    expect(det[0]!.mask?.enc).toBe('~');
  });
  it('treats empty output as zero matches and keys by object id, not position', () => {
    expect(parseSamOutput('')).toEqual([]);
    const sparse = parseSamOutput('<0f>0<|box;x1=0;y1=0;x2=99;y2=49;w=200;h=100;c=0.9|><|mask;x=0;y=0;c=0.9;data=2,2,!abcd|>,2<|box;x1=100;y1=50;x2=199;y2=99;w=200;h=100|><|mask;x=0;y=0;data=2,2,~xy|>');
    expect(sparse.map((d) => d.id)).toEqual([0, 2]);
    expect(sparse[0]!.confidence).toBe(0.9);
    expect(sparse[1]!.box).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
});

const wav = (rate: number, seconds: number, channels = 1): Uint8Array => {
  const n = rate * seconds * 2 * channels; const b = new Uint8Array(44 + n); const dv = new DataView(b.buffer);
  b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0); dv.setUint32(4, 36 + n, true); b.set([...'WAVEfmt '].map((c) => c.charCodeAt(0)), 8);
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, channels, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2 * channels, true); dv.setUint16(32, 2 * channels, true); dv.setUint16(34, 16, true);
  b.set([...'data'].map((c) => c.charCodeAt(0)), 36); dv.setUint32(40, n, true);
  return b;
};
describe('voice input checks', () => {
  it('accepts 16 and 24 kHz mono PCM16 and rejects others', () => {
    expect(inspectWav(wav(16000, 2)).seconds).toBe(2);
    expect(inspectWav(wav(24000, 1)).sampleRate).toBe(24000);
    expect(() => inspectWav(wav(44100, 1))).toThrow(/16 or 24 kHz/);
    expect(() => inspectWav(wav(16000, 1, 2))).toThrow(/mono/);
    expect(() => inspectWav(new TextEncoder().encode('not audio at all, definitely not riff'.repeat(3)))).toThrow(/WAV/);
  });
  it('normalises transcript shapes', () => {
    expect(transcriptText({ transcript: ' hello ' })).toBe('hello');
    expect(transcriptText({ turns: [{ transcript: 'one' }, { transcript: 'two' }] })).toBe('one two');
  });
});
