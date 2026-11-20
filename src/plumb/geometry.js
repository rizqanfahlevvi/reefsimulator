/**
 * Geometri 3D bagian rakit pipa (mm, ruang lokal bagian). Memakai angka yang sama dengan
 * catalog.js (portsOf/Z/dims), jadi sok, ulir, dan badan selalu tepat di port-nya.
 *
 * Keluaran: daftar { geo, mat } dengan mat ∈ 'body' | 'thread' | 'nut' | 'handle'.
 */
import * as THREE from 'three';
import { dims, portsOf, Z } from './catalog.js';

const Y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const SEG = 28;

/** Putar geometri yang dibuat sepanjang +Y (mulai y=0) ke arah dir, lalu geser ke titik at. */
function orient(geo, at, dir) {
  _q.setFromUnitVectors(Y, _v.set(dir[0], dir[1], dir[2]).normalize());
  geo.applyQuaternion(_q);
  geo.translate(at[0], at[1], at[2]);
  return geo;
}

/** Benda putar dari profil [r, y] (y sepanjang sumbu), tertutup. */
function lathe(profile, at, dir, seg = SEG) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.01, r), y));
  if (pts[0].distanceTo(pts[pts.length - 1]) > 1e-6) pts.push(pts[0].clone());
  return orient(new THREE.LatheGeometry(pts, seg), at, dir);
}

/** Selongsong (dinding rIn–rOut) sepanjang len dari at ke arah dir, tepi luar dibevel. */
function sleeve(at, dir, len, rIn, rOut, bevel = true) {
  const ch = bevel ? Math.min(1.2, (rOut - rIn) / 2.5, len / 3) : 0;
  return lathe(
    [
      [rIn, 0],
      [rOut, 0],
      [rOut, len - ch],
      [rOut - ch, len],
      [rIn, len],
    ],
    at,
    dir,
  );
}

/** Ulir drat luar (cincin bergigi, cukup meyakinkan secara visual) dengan lubang tembus rBore. */
function maleThread(at, dir, len, rMajor, pitch, rBore) {
  const depth = 0.55 * pitch;
  const prof = [[rBore, 0], [rMajor - depth, 0]];
  for (let y = 0; y + pitch <= len + 1e-6; y += pitch) {
    prof.push([rMajor, y + pitch * 0.45], [rMajor - depth, y + pitch]);
  }
  prof.push([rMajor - depth, len], [rBore, len]);
  return lathe(prof, at, dir, 24);
}

/** Prisma segi enam (kunci pas) sepanjang len, AF = jarak antar sisi datar. */
function hex(at, dir, len, af, rBore = 0) {
  const rc = af / Math.sqrt(3);
  const g = new THREE.CylinderGeometry(rc, rc, len, 6, 1, rBore <= 0);
  g.translate(0, len / 2, 0);
  return orient(g, at, dir);
}

function cylinder(a, b, r, seg = 24) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.translate(0, len / 2, 0);
  d.normalize();
  return orient(g, a, [d.x, d.y, d.z]);
}

function sphere(c, r) {
  const g = new THREE.SphereGeometry(r, 24, 16);
  g.translate(c[0], c[1], c[2]);
  return g;
}

/** Badan belokan: tabung sepanjang kurva (Bezier) dari port ke port. */
function bendBody(p0, d0, p1, d1, r, kind = 'quad') {
  const a = new THREE.Vector3(...p0);
  const b = new THREE.Vector3(...p1);
  let curve;
  if (kind === 'quad') {
    // titik sudut = perpotongan kedua kaki (di asal untuk knee)
    curve = new THREE.QuadraticBezierCurve3(a, new THREE.Vector3(0, 0, 0), b);
  } else {
    const k = 1.33 * a.distanceTo(b) * 0.5;
    curve = new THREE.CubicBezierCurve3(a, a.clone().addScaledVector(new THREE.Vector3(...d0), -k), b.clone().addScaledVector(new THREE.Vector3(...d1), -k), b);
  }
  return new THREE.TubeGeometry(curve, 24, r, 24, false);
}

const neg = (d) => [-d[0], -d[1], -d[2]];
const add = (p, d, s) => [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];

/** Ujung-ujung standar: sok polos, drat dalam, drat luar (dibuat di port masing-masing). */
function ends(out, ports, A, B) {
  for (const p of ports) {
    const D = p.slot === 'b' ? B : A;
    if (p.end === 'S') out.push({ geo: sleeve(p.p, p.d, D.sock, D.r, D.hubR), mat: 'body' });
    else if (p.end === 'F') {
      const pitch = 25.4 / D.tpi;
      out.push({ geo: sleeve(p.p, p.d, D.eng, D.thrD / 2 - 0.55 * pitch, D.fhubR), mat: 'body' });
      // rusuk pegangan di bibir drat dalam
      out.push({ geo: sleeve(add(p.p, p.d, D.eng - 3), p.d, 3, D.fhubR - 0.5, D.fhubR + 0.8), mat: 'body' });
    } else if (p.end === 'M') {
      const pitch = 25.4 / D.tpi;
      out.push({ geo: maleThread(add(p.p, p.d, -D.eng), p.d, D.eng, D.thrD / 2, pitch, D.id / 2), mat: 'thread' });
    }
  }
}

/**
 * @param {object} part { type, size, sizeB?, cls, len? }
 * @returns {Array<{geo: THREE.BufferGeometry, mat: string}>}
 */
export function partGeometry(part) {
  const A = dims(part.size, part.cls);
  const B = part.sizeB ? dims(part.sizeB, part.cls) : A;
  const ports = portsOf(part.type, A, B, part.len || 0);
  const out = [];
  const body = (geo) => out.push({ geo, mat: 'body' });
  const g = Z.g;
  const ring = (z0, z1, rIn, rOut) => body(sleeve([0, 0, z0], [0, 0, 1], z1 - z0, rIn, rOut, false));
  switch (part.type) {
    case 'pipe':
      body(sleeve([0, 0, 0], [0, 0, 1], part.len, A.id / 2, A.r, false));
      break;
    case 'elbow90':
    case 'elbow45':
    case 'elbowF':
    case 'elbow90r':
      body(bendBody(ports[0].p, ports[0].d, ports[1].p, ports[1].d, A.hubR * 0.9));
      ends(out, ports, A, B);
      break;
    case 'elbowMF': {
      const z = Z.z90(A);
      body(bendBody([0, 0, -z], [0, 0, -1], ports[1].p, ports[1].d, A.fhubR * 0.85));
      body(hex([0, 0, -z], [0, 0, -1], 2.5, A.thrD * 1.18 + 4)); // bahu sebelum ulir
      ends(out, ports, A, B);
      break;
    }
    case 'bend180': {
      body(bendBody(ports[0].p, ports[0].d, ports[1].p, ports[1].d, A.hubR * 0.9, 'cubic'));
      ends(out, ports, A, B);
      break;
    }
    case 'tee':
    case 'teeR':
    case 'teeF':
    case 'cross': {
      body(cylinder(ports[0].p, ports[1].p, A.hubR * 0.95));
      const br = part.type === 'teeR' ? B.hubR * 0.95 : part.type === 'teeF' ? A.fhubR * 0.95 : A.hubR * 0.95;
      body(cylinder([0, 0, 0], ports[2].p, br));
      if (part.type === 'cross') body(cylinder([0, 0, 0], ports[3].p, A.hubR * 0.95));
      ends(out, ports, A, B);
      break;
    }
    case 'socket':
      ring(-g, g, A.id / 2, A.hubR);
      ends(out, ports, A, B);
      break;
    case 'socketR': {
      const c = Z.cone(A, B);
      body(lathe([[A.id / 2, -g], [A.hubR, -g], [B.hubR, g + c], [B.id / 2, g + c]], [0, 0, 0], [0, 0, 1]));
      ends(out, ports, A, B);
      break;
    }
    case 'bushing': {
      // satu benda putar: bagian luar masuk sok A, bibir, sok B di dalam
      const prof = [
        [B.id / 2, -A.sock],
        [A.r, -A.sock],
        [A.r, 0],
        [A.hubR, 0],
        [A.hubR, 3],
        [B.r, 3],
        [B.r, 3 - B.sock],
        [B.id / 2, 3 - B.sock],
      ];
      body(lathe(prof, [0, 0, 0], [0, 0, 1]));
      break;
    }
    case 'socketF':
      ring(-g, g, A.id / 2, Math.max(A.hubR, A.fhubR));
      ends(out, ports, A, B);
      break;
    case 'socketM': {
      ring(-g, g, A.id / 2, A.hubR);
      const h = Z.hex(A);
      out.push({ geo: hex([0, 0, g], [0, 0, 1], h, A.thrD * 1.2 + 4), mat: 'body' });
      ends(out, ports, A, B);
      break;
    }
    case 'nipple': {
      const h = Z.hex(A);
      out.push({ geo: hex([0, 0, -h / 2], [0, 0, 1], h, A.thrD * 1.15 + 4), mat: 'body' });
      ends(out, ports, A, B);
      break;
    }
    case 'union': {
      const u = Z.u(A);
      body(cylinder(ports[0].p, ports[1].p, A.hubR * 0.98));
      // mur union bergerigi + garis belah
      const nr = A.hubR * 1.38;
      out.push({ geo: sleeve([0, 0, -u * 0.55], [0, 0, 1], u * 1.1, A.hubR * 0.9, nr), mat: 'nut' });
      for (let k = 0; k < 3; k++) out.push({ geo: sleeve([0, 0, -u * 0.45 + k * u * 0.38], [0, 0, 1], u * 0.12, nr, nr + 0.9, false), mat: 'nut' });
      ends(out, ports, A, B);
      break;
    }
    case 'bulkhead': {
      const b = Z.b(A);
      body(cylinder(ports[0].p, ports[1].p, A.hubR));
      body(sleeve([0, 0, -3], [0, 0, 1], 3, A.hubR, A.hubR * 1.9));
      out.push({ geo: hex([0, 0, 6], [0, 0, 1], Math.min(b - 1, 8), A.hubR * 2.9, 1), mat: 'nut' });
      ends(out, ports, A, B);
      break;
    }
    case 'cap':
    case 'capF': {
      const R = part.type === 'cap' ? A.hubR : A.fhubR;
      const t = 0.22 * A.od + 2; // kubah penutup di sisi luar
      const dome = Array.from({ length: 9 }, (_, i) => {
        const a = (i / 8) * (Math.PI / 2);
        return [R * Math.cos(a), t * Math.sin(a)];
      });
      body(lathe([[0.01, 0], ...dome], [0, 0, 0], [0, 0, 1]));
      ends(out, ports, A, B);
      break;
    }
    case 'plug': {
      const hl = 0.35 * A.thrD + 4;
      out.push({ geo: hex([0, 0, 0], [0, 0, 1], hl, A.thrD * 1.05 + 3), mat: 'body' });
      const pitch = 25.4 / A.tpi;
      out.push({ geo: maleThread([0, 0, -A.eng], [0, 0, 1], A.eng, A.thrD / 2, pitch, 0.01), mat: 'thread' });
      break;
    }
    case 'ballvalve': {
      const v = Z.v(A);
      body(cylinder(ports[0].p, ports[1].p, A.hubR * 1.05));
      body(sphere([0, 0, 0], A.hubR * 1.6));
      // mur union di kedua sisi
      for (const s of [-1, 1]) out.push({ geo: sleeve([0, 0, s > 0 ? v * 0.38 : -v * 0.62], [0, 0, 1], v * 0.24, A.hubR * 1.0, A.hubR * 1.35), mat: 'nut' });
      body(cylinder([0, A.hubR * 1.4, 0], [0, A.hubR * 2.3, 0], A.hubR * 0.35));
      // tuas sejajar pipa = terbuka
      const L = 1.15 * A.od + 30;
      const lever = new THREE.BoxGeometry(A.hubR * 0.7, A.hubR * 0.35, L);
      lever.translate(0, A.hubR * 2.45, L * 0.32);
      out.push({ geo: lever, mat: 'handle' });
      ends(out, ports, A, B);
      break;
    }
    case 'gatevalve': {
      body(cylinder(ports[0].p, ports[1].p, A.hubR * 1.05));
      body(sphere([0, 0, 0], A.hubR * 1.45));
      body(cylinder([0, 0, 0], [0, A.hubR * 3.0, 0], A.hubR * 0.75));
      body(cylinder([0, A.hubR * 3.0, 0], [0, A.hubR * 3.9, 0], A.hubR * 0.2));
      const wheel = new THREE.TorusGeometry(A.hubR * 1.25, A.hubR * 0.16, 10, 28);
      wheel.rotateX(Math.PI / 2);
      wheel.translate(0, A.hubR * 3.9, 0);
      out.push({ geo: wheel, mat: 'handle' });
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI * 2) / 3;
        out.push({ geo: cylinder([0, A.hubR * 3.9, 0], [Math.cos(a) * A.hubR * 1.25, A.hubR * 3.9, Math.sin(a) * A.hubR * 1.25], A.hubR * 0.1, 8), mat: 'handle' });
      }
      ends(out, ports, A, B);
      break;
    }
    case 'flange':
    case 'blindflange': {
      const Rf = 0.5 * (2.2 * A.od + 45);
      const z0 = part.type === 'flange' ? -g : 0;
      const z1 = part.type === 'flange' ? Z.flange(A) : 0.18 * A.od + 8;
      body(sleeve([0, 0, z0], [0, 0, 1], z1 - z0, part.type === 'flange' ? A.id / 2 : 0.01, Rf, true));
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2;
        const p = [Math.cos(a) * Rf * 0.74, Math.sin(a) * Rf * 0.74];
        const back = part.type === 'flange' ? z0 : z1;
        out.push({ geo: hex([p[0], p[1], back], [0, 0, part.type === 'flange' ? -1 : 1], 4, 0.18 * Rf), mat: 'nut' });
      }
      if (part.type === 'flange') ends(out, ports, A, B);
      break;
    }
    default:
      ends(out, ports, A, B);
  }
  return out;
}
