/** Kartu status skimmer: klasifikasi keadaan dari state hidrolik. */
import { describe, it, expect } from 'vitest';
import * as H from '../src/physics/hydraulics.js';
import { skimmerState } from '../src/ui/skimcard.js';

function sim(over, secs = 200) {
  const P = { ...H.defaultParams(), ...over };
  const S = H.initialState(P);
  for (let n = 0; n < secs / 0.02; n++) H.step(S, P, 0.02);
  return { P, S };
}
const split = { split: true, n: 2, D: 1.7, sk: 2, sv: 1, sv2: 1 };

describe('skimmerState', () => {
  it('bawaan (1 pipa, mangkuk tetap): skimmer bekerja, angka debit tersedia', () => {
    const s = skimmerState(sim({}));
    expect(s.kind).toBe('tee');
    expect(['ok', 'info']).toContain(s.level);
    expect(s.rows.find(([k]) => k === 'Lewat skimmer')[1]).toMatch(/L\/jam/);
  });
  it('pipa skimmer terpisah tanpa tambahan → masalah (putus/kering) dengan saran lubang cadangan', () => {
    const s = skimmerState(sim(split));
    expect(s.kind).toBe('split');
    expect(s.level).toBe('bad');
    expect(s.tip).toMatch(/lubang cadangan/);
  });
  it('pipa skimmer terpisah + lubang 8 mm → OK', () => {
    const s = skimmerState(sim({ ...split, bleed: 8 }));
    expect(s.level).toBe('ok');
    expect(s.rows.some(([k]) => k === '· dari lubang')).toBe(true);
  });
  it('tanpa skimmer & overflow box dilaporkan apa adanya', () => {
    expect(skimmerState(sim({ sk: 0 }, 10)).kind).toBe('none');
    expect(skimmerState(sim({ box: true }, 10)).kind).toBe('box');
  });
});
