/** Komponen 3D yang bisa diketuk: area sentuh, jangkar penanda, dan pemilihan dengan sinar. */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import * as H from '../src/physics/hydraulics.js';
import { DEFAULT_VIEW } from '../src/state.js';
import { HOT_KEYS, hotBoxes, hotAnchor, pickHot } from '../src/render/hotspots.js';
import { COMPONENTS } from '../src/ui/inspector.js';

function makeApp(over = {}) {
  const P = { ...H.defaultParams(), ...over };
  const S = H.initialState(P);
  for (let i = 0; i < 500; i++) H.step(S, P, 0.02);
  return { S, P, V: { ...DEFAULT_VIEW }, NZL: { yaw: 20, pitch: 15 }, WM: { q: 1000, yaw: 0, pitch: 0, y: 16 } };
}
const inside = (p, b) => p[0] >= b[0] && p[0] <= b[1] && p[1] >= b[2] && p[1] <= b[3] && p[2] >= b[4] && p[2] <= b[5];
/** Sinar dari posisi kamera ke titik sasaran. */
const rayTo = (from, to) => new THREE.Ray(new THREE.Vector3(...from), new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize());

describe('area sentuh komponen', () => {
  for (const over of [{}, { box: true, sv: 1, zd: 21.5 }, { sk: 0 }, { sk: 2 }, { n: 1, zin: 3, zd: 18 }]) {
    it('kotak valid & jangkar di dalam kotaknya: ' + JSON.stringify(over), () => {
      const app = makeApp(over);
      const boxes = hotBoxes(app);
      for (const k of HOT_KEYS) {
        expect(boxes[k].length).toBeGreaterThan(0);
        for (const b of boxes[k]) {
          expect(b[1]).toBeGreaterThan(b[0]);
          expect(b[3]).toBeGreaterThan(b[2]);
          expect(b[5]).toBeGreaterThan(b[4]);
        }
        const a = hotAnchor(app, k);
        expect(boxes[k].some((b) => inside(a, b)), k).toBe(true);
        expect(COMPONENTS[k].controls.length).toBeGreaterThan(0);
        expect(typeof COMPONENTS[k].info(app)).toBe('string');
      }
    });
  }

  it('sinar dari kamera "Miring" ke jangkar tiap komponen memilih komponen itu', () => {
    const app = makeApp();
    app.V.wm = true;
    const cam = [84, 44, 72];
    for (const k of HOT_KEYS) expect(pickHot(app, rayTo(cam, hotAnchor(app, k))), k).toBe(k);
  });

  it('sinar dari kamera "Filter" (belakang) memilih komponen filter', () => {
    const app = makeApp();
    const cam = [25, 40, -88];
    for (const k of ['outlet', 'pump', 'floss']) expect(pickHot(app, rayTo(cam, hotAnchor(app, k))), k).toBe(k);
  });

  it('sinar ke ruang kosong tidak memilih apa pun; kotak mengikuti parameter', () => {
    const app = makeApp();
    expect(pickHot(app, rayTo([84, 44, 72], [25, 60, 12]))).toBeNull();
    const y0 = hotBoxes(app).intake[0][2];
    app.P.zin = 14;
    expect(hotBoxes(app).intake[0][2]).toBeGreaterThan(y0);
    const w0 = hotBoxes(app).wm[0][2];
    app.WM.y = 22;
    expect(hotBoxes(app).wm[0][2]).toBeCloseTo(w0 + 6, 5);
  });
});

describe('tahap 2: seret untuk mengarahkan', () => {
  it('anglesOf adalah kebalikan dirOf', async () => {
    const { anglesOf } = await import('../src/render/hotspots.js');
    const { dirOf } = await import('../src/layout.js');
    for (const [y, p] of [[0, 0], [20, 15], [-90, -60], [80, 45], [-45, 30]]) {
      const a = anglesOf(dirOf(y, p));
      expect(a.yaw).toBeCloseTo(y, 6);
      expect(a.pitch).toBeCloseTo(p, 6);
    }
  });

  it('menunjuk titik → sudut dibulatkan ke langkah slider & dibatasi rentangnya', async () => {
    const { AIM, aimAngles, aimGeometry } = await import('../src/render/hotspots.js');
    const app = makeApp();
    const pv = AIM.nozzle.pivot(app);
    // lurus ke kiri, sedikit naik
    expect(aimAngles(AIM.nozzle, pv, [pv[0] - 10, pv[1] + 1.7, pv[2]])).toEqual({ yaw: 0, pitch: 10 });
    // ke depan (+z) → yaw 90
    expect(aimAngles(AIM.nozzle, pv, [pv[0], pv[1], pv[2] + 10]).yaw).toBe(90);
    // ke belakang-kanan (di luar rentang) → sisi terdekat, bukan melompat
    expect(aimAngles(AIM.nozzle, pv, [pv[0] + 10, pv[1], pv[2] + 2]).yaw).toBe(90);
    expect(aimAngles(AIM.nozzle, pv, [pv[0] + 10, pv[1], pv[2] - 2]).yaw).toBe(-90);
    // terlalu dekat titik putar → diabaikan (tidak bergetar)
    expect(aimAngles(AIM.nozzle, pv, [pv[0] - 1, pv[1], pv[2]])).toBeNull();
    // menunjuk bola pegangan sendiri → sudut tetap
    const g = aimGeometry(app, 'nozzle');
    expect(aimAngles(AIM.nozzle, g.pivot, g.knob)).toEqual({ yaw: 20, pitch: 15 });
    // wavemaker: pitch dibatasi ±45
    const w = AIM.wm.pivot(app);
    expect(aimAngles(AIM.wm, w, [w[0] - 5, w[1] + 20, w[2]]).pitch).toBe(45);
  });
});
