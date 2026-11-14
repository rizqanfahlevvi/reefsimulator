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

/* ======================= tahap 2: seret untuk mengarahkan ======================= */

const D = 180 / Math.PI;

/** Kebalikan dirOf: arah → {yaw, pitch} (derajat, konvensi sama dengan slider). */
export function anglesOf(d) {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return { yaw: Math.atan2(d[2], -d[0]) * D, pitch: Math.asin(Math.max(-1, Math.min(1, d[1] / l))) * D };
}

/**
 * Komponen yang bisa diarahkan: titik putar, panjang paruh (pangkal panah), panjang panah,
 * batas sudut (= batas slider), langkah (= langkah slider), dan id slider panel.
 */
export const AIM = {
  nozzle: {
    pivot: () => NOZZLE,
    nose: 4.3,
    len: 10,
    yaw: [-90, 90],
    pitch: [-60, 45],
    step: 5,
    ids: ['s_nyaw', 's_npit'],
    get: (app) => app.NZL,
  },
  wm: {
    pivot: (app) => [WAVEMAKER.x, app.WM.y, WAVEMAKER.z],
    nose: 2.7,
    len: 12,
    yaw: [-80, 80],
    pitch: [-45, 45],
    step: 5,
    ids: ['s_wyaw', 's_wpit'],
    get: (app) => app.WM,
    // badan wavemaker diseret naik/turun di kaca kanan
    height: { id: 's_wy', min: 5, max: 25, step: 1 },
  },
};

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const snap = (v, s) => Math.round(v / s) * s;

/**
 * Sudut baru dari titik yang ditunjuk jari (di bidang layar) relatif terhadap titik putar.
 * @returns {{yaw:number, pitch:number}|null} null bila titik terlalu dekat dengan titik putar
 */
export function aimAngles(spec, pivot, point) {
  const d = [point[0] - pivot[0], point[1] - pivot[1], point[2] - pivot[2]];
  if (Math.hypot(d[0], d[1], d[2]) < 2.5) return null;
  const a = anglesOf(d);
  // arah ke belakang (di luar rentang yaw) → sisi terdekat
  let yaw = a.yaw;
  if (yaw > spec.yaw[1] || yaw < spec.yaw[0]) yaw = Math.abs(yaw - spec.yaw[1]) < Math.abs(yaw - spec.yaw[0]) ? spec.yaw[1] : spec.yaw[0];
  return { yaw: clamp(snap(yaw, spec.step), spec.yaw), pitch: clamp(snap(a.pitch, spec.step), spec.pitch) };
}

/** Pangkal panah (ujung paruh) dan posisi bola pegangan untuk sudut sekarang. */
export function aimGeometry(app, key) {
  const spec = AIM[key];
  const p = spec.pivot(app);
  const { yaw, pitch } = spec.get(app);
  const d = dirOf(yaw, pitch);
  const start = [p[0] + d[0] * spec.nose, p[1] + d[1] * spec.nose, p[2] + d[2] * spec.nose];
  const knob = [start[0] + d[0] * spec.len, start[1] + d[1] * spec.len, start[2] + d[2] * spec.len];
  return { pivot: p, dir: d, start, knob };
}

/** Panah arah + bola pegangan; selalu terlihat (di atas kaca/batu) seperti gizmo. */
export function createAimHandle(scene) {
  const g = new THREE.Group();
  g.visible = false;
  g.renderOrder = 12;
  scene.add(g);
  // toneMapped: false → warna sama dengan penanda HTML (tidak dipucatkan tone mapping ACES)
  const blue = new THREE.MeshBasicMaterial({ color: 0x2a78d6, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, toneMapped: false });
  const shaftM = new THREE.MeshBasicMaterial({ color: 0x2a78d6, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, toneMapped: false });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.BackSide, toneMapped: false });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1, 10), shaftM);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 16), shaftM);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), blue);
  const ring = new THREE.Mesh(new THREE.SphereGeometry(1.28, 20, 14), white);
  for (const m of [shaft, cone, ring, knob]) {
    m.renderOrder = 12;
    g.add(m);
  }
  knob.renderOrder = 13;
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  return {
    /**
     * @param {{start:number[], knob:number[], dir:number[]}|null} geo
     * @param {boolean} active sedang diseret
     * @param {number} cmPerPx ukuran 1 px layar di posisi bola (cm) → bola & panah tetap ±11 px di layar
     */
    set(geo, active = false, cmPerPx = 0.09) {
      g.visible = !!geo;
      if (!geo) return;
      const [sx, sy, sz] = geo.start;
      const [kx, ky, kz] = geo.knob;
      v.set(kx - sx, ky - sy, kz - sz);
      const len = v.length();
      q.setFromUnitVectors(up, v.normalize());
      const r = Math.max(0.5, 11 * cmPerPx) * (active ? 1.25 : 1); // jari-jari bola (cm)
      const t = Math.max(0.6, r / 1.1); // skala ketebalan panah & kerucut
      const back = 1.9 * r; // panah berhenti di depan bola
      shaft.quaternion.copy(q);
      shaft.scale.set(t, Math.max(0.01, len - back - 0.7 * t), t);
      shaft.position.set(sx + v.x * (len - back) * 0.5, sy + v.y * (len - back) * 0.5, sz + v.z * (len - back) * 0.5);
      cone.quaternion.copy(q);
      cone.scale.setScalar(t);
      cone.position.set(kx - v.x * back, ky - v.y * back, kz - v.z * back);
      knob.position.set(kx, ky, kz);
      ring.position.set(kx, ky, kz);
      knob.scale.setScalar(r);
      ring.scale.setScalar(r);
    },
  };
}
