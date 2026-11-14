/**
 * Komponen yang bisa diketuk di tampilan 3D: area sentuh (kotak, sedikit lebih besar dari
 * bendanya supaya mudah diketuk di HP), titik jangkar untuk penanda, pemilihan dengan sinar
 * kamera, dan sorotan lembut pada komponen yang dipilih.
 *
 * Bagian geometri (hotBoxes, hotAnchor, pickHot) murni → bisa diuji tanpa browser.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GEO } from '../physics/constants.js';
import { rimOf, skimmerActive } from '../physics/hydraulics.js';
import { NOZZLE, WAVEMAKER, SIPHON, FILTER, siphonX, dirOf } from '../layout.js';

export const HOT_KEYS = ['intake', 'outlet', 'nozzle', 'wm', 'pump', 'floss', 'ato'];

/** Posisi ATO (wadah di luar filter) dan titik tetesnya. */
const ATO_TANK = [62, 14.4, -6];

/** Tinggi ball valve U-pipe di sisi filter (sama dengan render siphon). */
const valveY = (P) => Math.min(30.4, Math.max(P.zd + 2.6, 29.2));

/**
 * Kotak area sentuh per komponen, [x0, x1, y0, y1, z0, z1] dalam cm.
 * @returns {Record<string, number[][]>}
 */
export function hotBoxes(app) {
  const { P, S, WM, NZL } = app;
  const xs = Array.from({ length: P.n }, (_, i) => siphonX(P.n, i));
  const xa = Math.min(...xs) - 2.8;
  const xb = Math.max(...xs) + 2.8;
  const yc = GEO.YC;
  const out = {};

  // intake: pipa sisi tank + saringan + mangkuk surface skimmer (atau overflow box)
  if (P.box) out.intake = [[0.6, 9.4, 15.5, 28.6, 0.6, 7]];
  else {
    const rim = rimOf(S, P);
    const sk = skimmerActive(P, rim);
    out.intake = [[xa, xb, P.zin - 1, sk ? Math.min(30, rim + 1) : 30, 1, sk ? 9.8 : 6.2]];
  }
  // U-pipe sisi filter + ball valve + ujung buang, dan puncak U di atas bibir tank
  out.outlet = [
    [xa + 0.4, xb - 0.4, Math.min(P.zd, valveY(P) - 3) - 1.2, yc + 2.6, SIPHON.zFilter - 2.5, SIPHON.zFilter + 2.5],
    [xa + 0.4, xb - 0.4, 30.2, yc + 2.6, SIPHON.zFilter + 2.5, SIPHON.zTank + 1.7],
  ];
  // duckbill: dari pangkal sampai ujung (mengikuti arah)
  {
    const d = dirOf(NZL.yaw, NZL.pitch);
    const tip = [NOZZLE[0] + d[0] * 4.2, NOZZLE[1] + d[1] * 4.2, NOZZLE[2] + d[2] * 4.2];
    const m = 2.2;
    out.nozzle = [
      [Math.min(NOZZLE[0], tip[0]) - m, Math.max(NOZZLE[0], tip[0]) + m, Math.min(NOZZLE[1], tip[1]) - m, Math.max(NOZZLE[1], tip[1]) + m + 0.8, Math.min(NOZZLE[2], tip[2]) - m, Math.max(NOZZLE[2], tip[2]) + m],
    ];
  }
  out.wm = [[WAVEMAKER.x - 3.8, 49.8, WM.y - 3, WM.y + 3, WAVEMAKER.z - 3, WAVEMAKER.z + 3]];
  const p = FILTER.pump;
  out.pump = [[p.x0 - 0.6, p.x1 + 0.6, p.y0 - 0.5, p.y1 + 2.2, p.z0 - 0.6, p.z1 + 1.6]];
  const f = FILTER.floss;
  out.floss = [[0.6, f.x1 - 0.1, f.y0 - 0.6, f.y1 + 0.6, FILTER.z0, FILTER.z1]];
  out.ato = [[55.8, 68.2, -0.5, 14.8, -12.2, 0.2]];
  return out;
}

/** Titik jangkar penanda tiap komponen (cm). */
export function hotAnchor(app, key) {
  const { P, S, WM } = app;
  const x0 = siphonX(P.n, 0);
  switch (key) {
    case 'intake': {
      if (P.box) return [5, 27.6, 6.6];
      const rim = rimOf(S, P);
      return skimmerActive(P, rim) ? [x0, rim + 0.4, SIPHON.zTank + 3.6] : [x0, P.zin + 1.2, SIPHON.zTank];
    }
    case 'outlet':
      return [x0, valveY(P), SIPHON.zFilter];
    case 'nozzle':
      return [NOZZLE[0], NOZZLE[1], NOZZLE[2]];
    case 'wm':
      return [WAVEMAKER.x - 1, WM.y, WAVEMAKER.z];
    case 'pump':
      return [44.5, FILTER.pump.y1 + 0.5, -7.5];
    case 'floss':
      return [5.5, FILTER.floss.y1, -7.5];
    case 'ato':
      return ATO_TANK;
    default:
      return null;
  }
}

const _box = new THREE.Box3();
const _hit = new THREE.Vector3();

/**
 * Komponen terdekat yang terkena sinar. Bila dua kotak sama dekat (±0,5 cm), dipilih kotak
 * yang lebih kecil (komponen kecil di dalam/di depan komponen besar).
 * @param {object} app
 * @param {THREE.Ray} ray
 * @returns {string|null}
 */
export function pickHot(app, ray) {
  const boxes = hotBoxes(app);
  let best = null;
  let bestD = Infinity;
  let bestVol = Infinity;
  for (const [key, list] of Object.entries(boxes)) {
    for (const b of list) {
      _box.min.set(b[0], b[2], b[4]);
      _box.max.set(b[1], b[3], b[5]);
      if (!ray.intersectBox(_box, _hit)) continue;
      const d = _hit.distanceTo(ray.origin);
      const vol = (b[1] - b[0]) * (b[3] - b[2]) * (b[5] - b[4]);
      if (d < bestD - 0.5 || (Math.abs(d - bestD) <= 0.5 && vol < bestVol)) {
        best = key;
        bestD = d;
        bestVol = vol;
      }
    }
  }
  return best;
}

/**
 * Sorotan komponen terpilih: kotak membulat transparan yang "bernapas" pelan.
 * Geometri dibangun ulang hanya bila ukuran/posisi area sentuh berubah (mis. slider digeser).
 */
export function createHotHighlight(scene) {
  const g = new THREE.Group();
  g.renderOrder = 11;
  scene.add(g);
  const mat = new THREE.MeshBasicMaterial({ color: 0x2e9bff, transparent: true, opacity: 0.22, depthWrite: false });
  const rim = new THREE.MeshBasicMaterial({ color: 0x7cc6ff, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.BackSide });
  let key = '';
  const clear = () => {
    for (const m of g.children) m.geometry.dispose();
    g.clear();
  };
  return {
    /** @param {number[][]|null} boxes kotak area sentuh komponen terpilih */
    set(boxes) {
      const k = boxes ? JSON.stringify(boxes) : '';
      if (k === key) return;
      key = k;
      clear();
      if (!boxes) return;
      for (const b of boxes) {
        const w = b[1] - b[0];
        const h = b[3] - b[2];
        const d = b[5] - b[4];
        const r = Math.min(0.9, 0.25 * Math.min(w, h, d));
        const geo = new RoundedBoxGeometry(w, h, d, 3, r);
        for (const m of [mat, rim]) {
          const mesh = new THREE.Mesh(geo, m);
          mesh.position.set((b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2);
          mesh.renderOrder = 11;
          if (m === rim) mesh.scale.setScalar(1.02);
          g.add(mesh);
        }
      }
    },
    /** Animasi napas (t = waktu nyata, dtk). */
    tick(t) {
      if (!g.children.length) return;
      const s = 0.5 + 0.5 * Math.sin(t * 3.2);
      mat.opacity = 0.16 + 0.14 * s;
      rim.opacity = 0.3 + 0.25 * s;
    },
  };
}
