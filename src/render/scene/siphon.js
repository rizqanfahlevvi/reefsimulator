/**
 * U-pipe siphon (dibangun ulang saat parameter berubah): pipa, siku, saringan intake,
 * surface skimmer (mangkuk tetap / kepala mengapung), venturi, ball valve, dan isi pipa
 * (inti air, kantong udara, pancuran) yang dianimasikan.
 */
import * as THREE from 'three';
import { StaticBatch, boxGeo, cylGeo, sphereGeo, tubeGeo, elbowGeo, mesh } from '../geom.js';
import { GEO } from '../../physics/constants.js';
import { rimOf, skimmerActive } from '../../physics/hydraulics.js';
import { siphonX, SIPHON } from '../../layout.js';
import { makePoints, makePath, disposePoints } from './particles.js';

function clearGroup(g) {
  while (g.children.length) {
    const c = g.children[0];
    g.remove(c);
    if (c.children.length) clearGroup(c);
    if (c.geometry) c.geometry.dispose();
    if (c.isPoints) c.material.dispose();
  }
}

export function createSiphon(scene, M) {
  const sipG = new THREE.Group();
  scene.add(sipG);
  const state = { sipG, sip: [] };

  state.build = (app) => {
    const { P, S, V } = app;
    for (const o of state.sip) if (o.pts) disposePoints(o.pts);
    clearGroup(sipG);
    state.sip = [];
    const n = P.n;
    const D = P.D;
    const ro = D / 2 + 0.22; // radius luar pipa
    const ri = (D / 2) * 0.8; // radius inti air
    const yc = GEO.YC;
    const zi = SIPHON.zTank;
    const zo = SIPHON.zFilter;
    const R = SIPHON.bendR;
    const zin = P.box ? GEO.ZBOX : P.zin;
    const pm = V.clear ? M.clear : M.pvc;
    const rim0 = rimOf(S, P);
    const skOn = skimmerActive(P, rim0);
    const b = new StaticBatch();
    const pipeOpts = { order: 5, cast: !V.clear };

    for (let i = 0; i < n; i++) {
      const x = siphonX(n, i);
      const o = { x, sk: skOn, zb: zi + 3.6, zj: zin + GEO.ZJ };
      b.add(cylGeo([x, zin, zi], [x, yc - R, zi], ro, 20), pm, pipeOpts);
      b.add(cylGeo([x, yc, zi - R], [x, yc, zo + R], ro, 20), pm, pipeOpts);
      b.add(cylGeo([x, yc - R, zo], [x, P.zd, zo], ro, 20), pm, pipeOpts);
      b.add(elbowGeo(x, yc - R, zi - R, R, ro * 1.14, true), M.pvc, { cast: true });
      b.add(elbowGeo(x, yc - R, zo + R, R, ro * 1.14, false), M.pvc, { cast: true });
      b.add(cylGeo([x, yc - R - 1.1, zi], [x, yc - R, zi], ro * 1.14, 20), M.pvc);
      b.add(cylGeo([x, yc - R - 1.1, zo], [x, yc - R, zo], ro * 1.14, 20), M.pvc);

      /* saringan intake bawah */
      b.add(cylGeo([x, zin - 0.2, zi], [x, zin + 2.2, zi], ro * 1.4, 16), M.green);
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        const cx = x + Math.cos(a) * ro * 1.42;
        const cz = zi + Math.sin(a) * ro * 1.42;
        b.add(boxGeo(cx - 0.1, cx + 0.1, zin + 0.1, zin + 1.9, cz - 0.06, cz + 0.06), M.dark);
      }

      if (skOn) {
        const { zj, zb } = o;
        const fl = P.sk === 2;
        const zTop = fl ? Math.max(zj + 1.5, rim0 - GEO.CUPD - 3.5) : rim0 - GEO.CUPD;
        b.add(cylGeo([x, zj - 1, zi], [x, zj + 1, zi], ro * 1.14, 20), M.pvc);
        b.add(cylGeo([x, zj, zi], [x, zj, zb], ro, 20), pm, { order: 5 });
        b.add(cylGeo([x, zj, zb], [x, zTop, zb], ro, 20), pm, { order: 5 });
        b.add(sphereGeo([x, zj, zb], ro * 1.22), M.pvc);

        // mangkuk (bergerak naik-turun untuk tipe mengapung)
        const cg = new THREE.Group();
        cg.position.set(x, rim0, zb);
        sipG.add(cg);
        o.cupG = cg;
        const cm = fl ? M.clear : M.pvc2;
        const toothM = fl ? M.white : M.pvc2;
        const cb = new StaticBatch();
        const wall = new THREE.CylinderGeometry(2.3, 2.3, GEO.CUPD - 1, 32, 1, true);
        wall.translate(0, -(GEO.CUPD + 1) / 2, 0);
        cb.add(wall, cm);
        const bottom = new THREE.CylinderGeometry(2.3, ro, 0.9, 32, 1, false);
        bottom.translate(0, -GEO.CUPD - 0.45, 0);
        cb.add(bottom, cm);
        for (let k = 0; k < 10; k++) {
          const a = (k * Math.PI) / 5;
          const t = new THREE.BoxGeometry(0.62, 1.3, 0.28);
          t.rotateY(Math.PI / 2 - a);
          t.translate(Math.cos(a) * 2.3, -0.35, Math.sin(a) * 2.3);
          cb.add(t, toothM);
        }
        const ring = new THREE.TorusGeometry(2.3, 0.16, 8, 32);
        ring.rotateX(Math.PI / 2);
        ring.translate(0, 0.3, 0);
        cb.add(ring, toothM);
        if (fl) {
          const fr = new THREE.TorusGeometry(2.75, 0.5, 12, 32);
          fr.rotateX(Math.PI / 2);
          fr.translate(0, -0.6, 0);
          cb.add(fr, M.white);
          const sl = new THREE.CylinderGeometry(ro * 1.25, ro * 1.25, 8, 20, 1, true);
          sl.translate(0, -GEO.CUPD - 0.9 - 4, 0);
          cb.add(sl, M.clear);
        }
        cb.build(cg);
        o.cupW = mesh(new THREE.CylinderGeometry(2.12, 2.12, 1, 24), M.core, sipG, { order: 4 });
        o.brW = mesh(new THREE.CylinderGeometry(ri, ri, 1, 10), M.core, sipG);
      }

      // tee udara di puncak U + venturi / tutup
      b.add(cylGeo([x, yc, -3.2], [x, yc, -0.8], ro * 1.14, 20), M.pvc);
      b.add(cylGeo([x, yc, -2], [x, yc + 2.2, -2], 0.4, 10), M.pvc);
      b.add(sphereGeo([x, yc + 2.3, -2], 0.5), P.venturi ? M.green : M.red);
      if (P.venturi) {
        b.add(
          tubeGeo(
            [
              [x, yc + 2.5, -2],
              [x + 1.5, yc + 3.6, -5],
              [x + 6, yc + 1.5, -12.6],
              [38, 31.6, -13.2],
              [45.5, 31, -12.3],
              [45.6, 12, -11.8],
              [45.2, 4.8, -10.3],
            ],
            0.2,
          ),
          M.air,
        );
      }
      // ball valve di sisi filter
      const vy = Math.min(30.4, Math.max(P.zd + 2.6, 29.2));
      b.add(cylGeo([x, vy - 1.4, zo], [x, vy + 1.4, zo], ro * 1.65, 20), M.pvcG);
      b.add(cylGeo([x, vy, zo], [x, vy, zo - ro * 1.65 - 0.5], 0.45, 10), M.pvcG);
      const hg = new THREE.BoxGeometry(0.75, 3.8, 0.4);
      hg.translate(0, 1.2, 0);
      o.handle = mesh(hg, M.red, sipG);
      o.handle.position.set(x, vy, zo - ro * 1.65 - 0.6);

      // isi pipa: inti air, kantong udara di puncak, pancuran bebas di ujung buang
      o.cores = [
        mesh(cylGeo([x, zin, zi], [x, yc - R, zi], ri, 10), M.core, sipG),
        mesh(cylGeo([x, yc, zi - R], [x, yc, zo + R], ri, 10), M.core, sipG),
        mesh(cylGeo([x, yc - R, zo], [x, P.zd, zo], ri, 10), M.core, sipG),
      ];
      o.air = mesh(new THREE.CylinderGeometry(ri * 1.02, ri * 1.02, 1, 12), M.airM, sipG);
      o.air.rotation.x = Math.PI / 2;
      o.air.position.set(x, yc, (zi + zo) / 2);
      o.stream = mesh(new THREE.CylinderGeometry(ri * 0.8, ri * 0.6, 1, 12), M.stream, sipG);
      o.stream.visible = false;
      o.path = makePath([
        [x, zin, zi],
        [x, yc, zi],
        [x, yc, zo],
        [x, P.zd, zo],
      ]);
      o.pts = makePoints(9, 0xff8a00, 1.5, sipG);
      state.sip.push(o);
    }
    b.build(sipG);

    state.tankPath = makePath([
      [41, 25.7, 3.5],
      [32, 26.4, 9],
      [18, 24, 10.5],
      [9, Math.min(24, zin + 6), P.box ? 9 : 6.5],
      [5, P.box ? 27 : zin + 0.8, P.box ? 6.6 : 3.5],
    ]);
  };
  return state;
}
