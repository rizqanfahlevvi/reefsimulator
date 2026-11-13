/**
 * Ketahanan: klien CFD pulih dari error engine / medan NaN tanpa macet,
 * dan log diagnostik menggabungkan kejadian berulang.
 */
import { describe, it, expect } from 'vitest';
import { FlowClient } from '../src/cfd/client.js';
import * as H from '../src/physics/hydraulics.js';
import { DEFAULT_VIEW } from '../src/state.js';
import { T3, F3 } from '../src/cfd/grid.js';
import { diag, logEvent, errorText } from '../src/diag.js';

function makeClient() {
  const P = H.defaultParams();
  const S = H.initialState(P);
  const app = { S, P, V: { ...DEFAULT_VIEW }, NZL: { yaw: 20, pitch: 15 }, WM: { q: 1000, yaw: 0, pitch: 0, y: 16 }, paused: false, flowStats: {} };
  const events = [];
  let off = 0;
  const fc = new FlowClient(app, { onEvent: (k, m) => events.push([k, m]), onCfdOff: () => off++ });
  const sent = [];
  fc.send = (m) => sent.push(m);
  return { fc, app, events, sent, cfdOff: () => off };
}

/** Hasil engine palsu dengan buffer yang dikirim di pesan. */
function fakeResult(m, fill = 0) {
  const o = {};
  for (const k of ['u', 'v', 'w', 'm', 'fu', 'fv', 'fw', 'fm', 'ta', 'td', 'ts', 'fa', 'fd', 'fs']) o[k] = m['b' + k].fill(k === 'ts' || k === 'fs' ? 35 : fill);
  return o;
}

describe('klien CFD tahan error', () => {
  it('error dari engine: buffer dipulihkan, permintaan berikutnya tetap jalan, medan diulang', () => {
    const { fc, events, sent } = makeClient();
    fc.tick(0.05, 0.05);
    expect(sent.length).toBe(1);
    expect(fc.busy).toBe(true);
    fc.onResult({ t: 'error', message: 'uji' });
    expect(fc.busy).toBe(false);
    expect(fc.spare.u.length).toBe(T3.N);
    expect(fc.spare.fu.length).toBe(F3.N);
    expect(events.some(([k, m]) => k === 'error' && m.includes('uji'))).toBe(true);
    fc.tick(0.05, 0.05);
    expect(sent.length).toBe(2);
    expect(sent[1].reset).toBe(true);
  });

  it('5 error berturut-turut: CFD dimatikan dan UI diberi tahu', () => {
    const { fc, app, cfdOff } = makeClient();
    for (let i = 0; i < 5; i++) fc.onResult({ t: 'error', message: 'x' });
    expect(app.V.cfd).toBe(false);
    expect(cfdOff()).toBe(1);
  });

  it('medan NaN dari engine dinolkan dan diulang otomatis', () => {
    const { fc, events, sent } = makeClient();
    fc.tick(0.05, 0.05);
    const r = fakeResult(sent[0], 1);
    r.u[0] = NaN;
    fc.onResult(r);
    expect(fc.perf.resets).toBe(1);
    expect(Number.isFinite(fc.fu[0])).toBe(true);
    expect(fc.fu[3]).toBe(0);
    expect(events.some(([, m]) => m.includes('NaN'))).toBe(true);
    fc.tick(0.05, 0.05);
    expect(sent[1].reset).toBe(true);
  });

  it('hasil normal tidak memicu pemulihan dan mencatat waktu per langkah', () => {
    const { fc, sent } = makeClient();
    fc.tick(0.05, 0.05);
    fc.onResult(fakeResult(sent[0], 2));
    expect(fc.perf.resets).toBe(0);
    expect(fc.perf.errors).toBe(0);
    expect(fc.fu[5]).toBe(2);
    expect(fc.perf.ms).toBeGreaterThanOrEqual(0);
  });
});

describe('log diagnostik', () => {
  it('kejadian sama berturut-turut digabung, jumlah error dihitung, log dibatasi', () => {
    const e0 = diag.errors;
    logEvent('error', 'Render: gagal');
    logEvent('error', 'Render: gagal');
    const last = diag.events[diag.events.length - 1];
    expect(last.n).toBe(2);
    expect(diag.errors - e0).toBe(2);
    for (let i = 0; i < 100; i++) logEvent('info', 'x' + i);
    expect(diag.events.length).toBeLessThanOrEqual(40);
  });

  it('errorText memberi pesan + lokasi tanpa domain', () => {
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at step (https://reefsimulator.vercel.app/assets/engine-abc.js:12:34)';
    expect(errorText(err)).toBe('boom (step (assets/engine-abc.js:12:34))');
    expect(errorText(null)).toBe('tidak diketahui');
  });
});

describe('skala warna pewarna', () => {
  it('mengikuti kadar tertinggi (minimal 10%), bukan dikunci 0–100%', async () => {
    const { RangeTracker, legendTicks } = await import('../src/render/quantity.js');
    const r = new RangeTracker();
    // pulsa sudah tercampur: p98 ±6% → skala 0–10%
    r.update('dye', [{ p02: 0, p95: 5, p98: 6 }], 0, 1, true);
    expect(r.max).toBeCloseTo(10, 5);
    // awan pekat di awal pulsa: p98 40% → skala 46%
    r.update('dye', [{ p02: 0, p95: 30, p98: 40 }], 0, 1, true);
    expect(r.max).toBeCloseTo(46, 5);
    // pewarna terus-menerus: tidak melebihi 100%
    r.update('dye', [{ p02: 80, p95: 98, p98: 100 }], 0, 1, true);
    expect(r.max).toBe(100);
    expect(legendTicks('dye', 0, 100).map((t) => t.text)).toEqual(['0%', '50%', '100%']);
    expect(legendTicks('dye', 0, 12).map((t) => t.text)).toEqual(['0%', '6,0%', '12%']);
  });
});
