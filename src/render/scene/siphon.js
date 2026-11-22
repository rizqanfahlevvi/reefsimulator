/**
 * U-pipe siphon (dibangun ulang saat parameter berubah): pipa, siku, saringan intake,
 * surface skimmer (mangkuk tetap / kepala mengapung), venturi, ball valve, dan isi pipa
 * (inti air, kantong udara, pancuran) yang dianimasikan.
 */
import * as THREE from 'three';
import { StaticBatch, boxGeo, cylGeo, sphereGeo, tubeGeo, elbowGeo, mesh } from '../geom.js';
import { GEO } from '../../physics/constants.js';
import { rimOf, skimmerActive, isSplit, SPLIT, isFloating, teleGeom } from '../../physics/hydraulics.js';
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

/* skimmer tipe 3 (kepala apung teleskopik, model toko): plastik merah */
const RED = new THREE.MeshStandardMaterial({ color: 0xd42a22, roughness: 0.34 });
const RED_D = new THREE.MeshStandardMaterial({ color: 0xa81d17, roughness: 0.42 });
const HEAD_R = 1.95;

/**
 * Kepala skimmer apung teleskopik di ruang lokal (bibir di y = 0): pita atas, 8 celah samping,
 * pita bawah, bilah spiral di mulut atas, corong, batang (meluncur di tabung bening), dan
 * pemberat non-logam + cable tie bila kedalaman bibir disetel lebih dalam dari bawaan.
 */
function teleHead(cb, M, stemLen, stemR, weights) {
  const ring = (y0, y1, r, mat) => {
    const g = new THREE.CylinderGeometry(r, r, y1 - y0, 40, 1, true);
    g.translate(0, (y0 + y1) / 2, 0);
    cb.add(g, mat);
  };
  ring(-0.5, 0, HEAD_R, RED);
  ring(-0.5, 0, HEAD_R - 0.18, RED_D);
  cb.add(new THREE.RingGeometry(HEAD_R - 0.18, HEAD_R, 40).rotateX(-Math.PI / 2), RED);
  ring(-2.85, -2.25, HEAD_R, RED);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const post = new THREE.BoxGeometry(0.62, 1.75, 0.22);
    post.rotateY(-a + Math.PI / 2);
    post.translate(Math.cos(a) * (HEAD_R - 0.1), -1.375, Math.sin(a) * (HEAD_R - 0.1));
    cb.add(post, RED);
  }
  const hub = new THREE.CylinderGeometry(0.42, 0.42, 0.75, 16);
  hub.translate(0, -0.52, 0);
  cb.add(hub, RED_D);
  for (let k = 0; k < 9; k++) {
    const bl = new THREE.BoxGeometry(1.35, 0.7, 0.12);
    bl.translate(0.95, -0.5, 0);
    bl.rotateY(-(k / 9) * Math.PI * 2 - 0.5);
    cb.add(bl, RED_D);
  }
  const fun = new THREE.LatheGeometry(
    [
      [HEAD_R, -2.85],
      [stemR + 0.08, -4.35],
      [stemR - 0.1, -4.35],
      [HEAD_R - 0.18, -2.85],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    40,
  );
  cb.add(fun, RED);
  const stem = new THREE.CylinderGeometry(stemR, stemR, stemLen, 24);
  stem.translate(0, -4.35 - stemLen / 2, 0);
  cb.add(stem, RED);
  if (weights) {
    for (const s of [-1, 1]) {
      const w = new THREE.CylinderGeometry(0.34, 0.34, 1.5, 14);
      w.translate(s * (stemR + 0.36), -5.3, 0);
      cb.add(w, M.white);
    }
    for (const y of [-4.95, -5.65]) {
      const t = new THREE.TorusGeometry(stemR + 0.36, 0.07, 6, 32);
      t.rotateX(Math.PI / 2);
      t.translate(0, y, 0);
      cb.add(t, M.dark);
    }
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

    const split = isSplit(P);
    for (let i = 0; i < n; i++) {
      const x = siphonX(n, i);
      // susunan terpisah: pipa 0 hanya intake bawah, pipa 1 khusus surface skimmer (kepala di kaki tank)
      const skPipe = split && i === 1;
      const skHere = skPipe || (skOn && !split);
      const rimI = skPipe ? rimOf(S, P, 1) : rim0;
      const flI = isFloating(P);
      // tipe 3 di pipa skimmer terpisah: kaki tank turun ke belokan J, lalu riser + tabung bening
      const tele = skHere && P.sk === 3;
      const tg = tele ? teleGeom(P, skPipe ? 4 : zin + GEO.ZJ + 1.5) : null;
      const zr = tele && skPipe ? zi + tg.dz : null;
      const legBot = skPipe ? (tele ? tg.yJ : flI ? rimI - GEO.CUPD - 3.5 : rimI - GEO.CUPD) : zin;
      const o = { x, sk: skHere, skPipe, zb: skPipe ? (tele ? zr : zi) : zi + 3.6, zj: zin + GEO.ZJ };
      b.add(cylGeo([x, legBot, zi], [x, yc - R, zi], ro, 20), pm, pipeOpts);
      if (tele && skPipe) {
        // belokan J: dasar mendatar ke arah dalam tank, riser, sok, tabung bening
        b.add(cylGeo([x, tg.yJ, zi], [x, tg.yJ, zr], ro, 20), pm, pipeOpts);
        b.add(sphereGeo([x, tg.yJ, zi], ro * 1.12), M.pvc);
        b.add(sphereGeo([x, tg.yJ, zr], ro * 1.12), M.pvc);
        b.add(cylGeo([x, tg.yJ, zr], [x, tg.tubeBot, zr], ro, 20), pm, pipeOpts);
      }
      if (tele) {
        const zt = o.zb;
        b.add(cylGeo([x, tg.tubeBot - 0.6, zt], [x, tg.tubeBot + 0.8, zt], ro * 1.3, 20), M.pvc);
        b.add(cylGeo([x, tg.tubeBot, zt], [x, tg.tubeTop, zt], ro * 1.02, 24, ro * 1.02, true), M.clear, { order: 6 });
      }
      b.add(cylGeo([x, yc, zi - R], [x, yc, zo + R], ro, 20), pm, pipeOpts);
      b.add(cylGeo([x, yc - R, zo], [x, P.zd, zo], ro, 20), pm, pipeOpts);
      b.add(elbowGeo(x, yc - R, zi - R, R, ro * 1.14, true), M.pvc, { cast: true });
      b.add(elbowGeo(x, yc - R, zo + R, R, ro * 1.14, false), M.pvc, { cast: true });
      b.add(cylGeo([x, yc - R - 1.1, zi], [x, yc - R, zi], ro * 1.14, 20), M.pvc);
      b.add(cylGeo([x, yc - R - 1.1, zo], [x, yc - R, zo], ro * 1.14, 20), M.pvc);

      /* saringan intake bawah (tidak ada di pipa khusus skimmer) */
      if (!skPipe) {
        b.add(cylGeo([x, zin - 0.2, zi], [x, zin + 2.2, zi], ro * 1.4, 16), M.green);
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4;
          const cx = x + Math.cos(a) * ro * 1.42;
          const cz = zi + Math.sin(a) * ro * 1.42;
          b.add(boxGeo(cx - 0.1, cx + 0.1, zin + 0.1, zin + 1.9, cz - 0.06, cz + 0.06), M.dark);
        }
      } else {
        // lubang cadangan (menghadap depan) & dop berlubang di ujung buang
        if (P.bleed > 0) {
          if (tele) {
            const zm = (zi + zr) / 2; // di dasar J (selalu terendam, tidak tertutup batang)
            b.add(cylGeo([x + ro - 0.06, tg.yJ, zm], [x + ro + 0.04, tg.yJ, zm], Math.max(0.18, P.bleed / 20), 14), M.dark);
          } else b.add(cylGeo([x, SPLIT.bleedY, zi + ro - 0.06], [x, SPLIT.bleedY, zi + ro + 0.04], Math.max(0.18, P.bleed / 20), 14), M.dark);
        }
        if (P.cap > 0) {
          b.add(cylGeo([x, P.zd - 0.45, zo], [x, P.zd + 0.05, zo], ro * 1.16, 20), M.pvc);
          b.add(cylGeo([x, P.zd - 0.5, zo], [x, P.zd - 0.44, zo], Math.min(ro, P.cap / 20), 14), M.dark);
        }
      }

      if (skHere) {
        const { zj, zb } = o;
        const fl = flI;
        if (!skPipe) {
          const zTop = tele ? tg.tubeBot : fl ? Math.max(zj + 1.5, rim0 - GEO.CUPD - 3.5) : rim0 - GEO.CUPD;
          b.add(cylGeo([x, zj - 1, zi], [x, zj + 1, zi], ro * 1.14, 20), M.pvc);
          b.add(cylGeo([x, zj, zi], [x, zj, zb], ro, 20), pm, { order: 5 });
          b.add(cylGeo([x, zj, zb], [x, zTop, zb], ro, 20), pm, { order: 5 });
          b.add(sphereGeo([x, zj, zb], ro * 1.22), M.pvc);
        }

        // mangkuk (bergerak naik-turun untuk tipe mengapung)
        const cg = new THREE.Group();
        cg.position.set(x, rimI, zb);
        sipG.add(cg);
        o.cupG = cg;
        const cm = fl ? M.clear : M.pvc2;
        const toothM = fl ? M.white : M.pvc2;
        const cb = new StaticBatch();
        if (tele) {
          teleHead(cb, M, tg.stem, ro * 0.82, P.fsub > 4);
          cb.build(cg);
        }
        const wall = new THREE.CylinderGeometry(2.3, 2.3, GEO.CUPD - 1, 32, 1, true);
        wall.translate(0, -(GEO.CUPD + 1) / 2, 0);
        if (!tele) cb.add(wall, cm);
        const bottom = new THREE.CylinderGeometry(2.3, ro, 0.9, 32, 1, false);
        bottom.translate(0, -GEO.CUPD - 0.45, 0);
        if (!tele) cb.add(bottom, cm);
        for (let k = 0; k < (tele ? 0 : 10); k++) {
          const a = (k * Math.PI) / 5;
          const t = new THREE.BoxGeometry(0.62, 1.3, 0.28);
          t.rotateY(Math.PI / 2 - a);
          t.translate(Math.cos(a) * 2.3, -0.35, Math.sin(a) * 2.3);
          cb.add(t, toothM);
        }
        const ring = new THREE.TorusGeometry(2.3, 0.16, 8, 32);
        ring.rotateX(Math.PI / 2);
        ring.translate(0, 0.3, 0);
        if (!tele) cb.add(ring, toothM);
        if (fl && !tele) {
          const fr = new THREE.TorusGeometry(2.75, 0.5, 12, 32);
          fr.rotateX(Math.PI / 2);
          fr.translate(0, -0.6, 0);
          cb.add(fr, M.white);
          const sl = new THREE.CylinderGeometry(ro * 1.25, ro * 1.25, 8, 20, 1, true);
          sl.translate(0, -GEO.CUPD - 0.9 - 4, 0);
          cb.add(sl, M.clear);
        }
        if (!tele) cb.build(cg);
        const cwR = tele ? HEAD_R - 0.25 : 2.12;
        o.cupW = mesh(new THREE.CylinderGeometry(cwR, cwR, 1, 24), M.core, sipG, { order: 4 });
        if (!skPipe) o.brW = mesh(new THREE.CylinderGeometry(ri, ri, 1, 10), M.core, sipG);
        // tirai air yang jatuh dari bibir ke dalam kepala skimmer (terlihat saat air permukaan masuk)
        o.sheet = mesh(new THREE.CylinderGeometry(cwR - 0.05, cwR - 0.05, 1, 32, 1, true), M.sheet, sipG, { order: 4 });
        o.sheet.visible = false;
        // gelembung udara yang tersedot: naik di kaki tank menuju puncak U (penanda, selalu terlihat)
        o.bubs = makePoints(16, 0xffffff, 0.8, sipG);
        o.bubs.p.material.depthTest = false;
        o.bubs.p.renderOrder = 13;
        const zcb0 = rimI - GEO.CUPD;
        o.bubPath = makePath(
          skPipe && tele
            ? [
                [x, zcb0, zr],
                [x, tg.yJ, zr],
                [x, tg.yJ, zi],
                [x, yc - R, zi],
              ]
            : skPipe
            ? [
                [x, zcb0, zi],
                [x, yc - R, zi],
              ]
            : [
                [x, zcb0, zb],
                [x, zj, zb],
                [x, zj, zi],
                [x, yc - R, zi],
              ],
        );
      }
      const vent = skPipe ? P.vent2 : P.venturi;

      // tee udara di puncak U + venturi / tutup
      b.add(cylGeo([x, yc, -3.2], [x, yc, -0.8], ro * 1.14, 20), M.pvc);
      b.add(cylGeo([x, yc, -2], [x, yc + 2.2, -2], 0.4, 10), M.pvc);
      b.add(sphereGeo([x, yc + 2.3, -2], 0.5), vent ? M.green : M.red);
      if (vent) {
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
      // ball valve di sisi filter (pipa skimmer terpisah: hanya bila dipakai)
      if (!skPipe || P.sv2 < 1) {
        const vy = Math.min(30.4, Math.max(P.zd + 2.6, 29.2));
        b.add(cylGeo([x, vy - 1.4, zo], [x, vy + 1.4, zo], ro * 1.65, 20), M.pvcG);
        b.add(cylGeo([x, vy, zo], [x, vy, zo - ro * 1.65 - 0.5], 0.45, 10), M.pvcG);
        const hg = new THREE.BoxGeometry(0.75, 3.8, 0.4);
        hg.translate(0, 1.2, 0);
        o.handle = mesh(hg, M.red, sipG);
        o.handle.position.set(x, vy, zo - ro * 1.65 - 0.6);
      }

      // isi pipa: inti air, kantong udara di puncak, pancuran bebas di ujung buang
      o.cores = [
        mesh(cylGeo([x, legBot, zi], [x, yc - R, zi], ri, 10), M.core, sipG),
        mesh(cylGeo([x, yc, zi - R], [x, yc, zo + R], ri, 10), M.core, sipG),
        mesh(cylGeo([x, yc - R, zo], [x, P.zd, zo], ri, 10), M.core, sipG),
      ];
      o.air = mesh(new THREE.CylinderGeometry(ri * 1.02, ri * 1.02, 1, 12), M.airM, sipG);
      o.air.rotation.x = Math.PI / 2;
      o.air.position.set(x, yc, (zi + zo) / 2);
      o.stream = mesh(new THREE.CylinderGeometry(ri * 0.8, ri * 0.6, 1, 12), M.stream, sipG);
      o.stream.visible = false;
      o.path = makePath([
        [x, legBot, zi],
        [x, yc, zi],
        [x, yc, zo],
        [x, P.zd, zo],
      ]);
      o.pts = makePoints(9, 0xff8a00, 1.5, sipG);
      state.sip.push(o);
    }
    b.build(sipG);

  };
  return state;
}
