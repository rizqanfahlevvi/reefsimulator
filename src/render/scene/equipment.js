/**
 * Peralatan: overflow box, kapas, protein skimmer, media bio, pompa return, ATO,
 * pompa udara, saklar pelampung, selang return + duckbill, wavemaker.
 */
import * as THREE from 'three';
import { StaticBatch, boxGeo, cylGeo, tubeGeo, sphereGeo, mesh } from '../geom.js';
import { fbm, createRng } from '../../util/random.js';
import { GEO } from '../../physics/constants.js';
import { NOZZLE, WAVEMAKER } from '../../layout.js';

export const RETURN_PTS = [
  [44.5, 6.2, -7.5],
  [44.5, 31, -7.5],
  [44.5, 33.6, -5.2],
  [44.5, 33.6, 1.2],
  [44.5, 31, 3.5],
  [44.5, GEO.ZOUT + 0.9, 3.5],
];

export function buildEquipment(scene, M) {
  const rnd = createRng(77);
  const out = {};
  const sb = new StaticBatch(); // langsung di scene

  /* overflow box (opsional) */
  out.boxG = new THREE.Group();
  scene.add(out.boxG);
  {
    const b = new StaticBatch();
    const part = (x0, x1, y0, y1, z0, z1, edges = true) => {
      const g = boxGeo(x0, x1, y0, y1, z0, z1);
      if (edges) b.addEdges(g, M.edge);
      b.add(g, M.clear);
    };
    part(1, 9, 16, 16.3, 0.5, 6.5);
    part(1, 1.3, 16, 28, 0.5, 6.5);
    part(8.7, 9, 16, 28, 0.5, 6.5);
    part(1, 9, 16, 26.5, 6.2, 6.5);
    for (let i = 0; i < 8; i++) part(1.3 + i * 0.95, 1.3 + i * 0.95 + 0.45, 26.5, 28, 6.2, 6.5, false);
    b.build(out.boxG);
  }

  /* kapas filter: blok bergelombang, warnanya menggelap saat kotor */
  {
    const g = new THREE.BoxGeometry(9.2, 7, 9.2, 10, 8, 10);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const X = p.getX(i);
      const Y = p.getY(i);
      const Z = p.getZ(i);
      const k = 1 + 0.07 * (fbm(X * 0.9 + 5, Y * 0.9, Z * 0.9) - 0.5);
      p.setXYZ(i, X * k, Y * k, Z * k);
    }
    g.computeVertexNormals();
    mesh(g, M.floss, scene).position.set(5.5, 15.5, -7.5);
  }

  /* protein skimmer */
  out.skG = new THREE.Group();
  scene.add(out.skG);
  {
    const b = new StaticBatch();
    b.add(cylGeo([16, 0.2, -7.5], [16, 22, -7.5], 4.3, 32), M.skBody, { order: 7 });
    b.add(cylGeo([16, 22, -7.5], [16, 26, -7.5], 4.3, 32, 1.5), M.skBody, { order: 7 });
    b.add(cylGeo([16, 26, -7.5], [16, 35, -7.5], 1.5, 20), M.skBody, { order: 7 });
    b.add(cylGeo([16, 30.5, -7.5], [16, 37.4, -7.5], 3.3, 28), M.skCup, { order: 7 });
    b.add(cylGeo([16, 37.4, -7.5], [16, 38, -7.5], 3.5, 28), M.skCap);
    for (const y of [0.2, 10, 21.6]) {
      const t = new THREE.TorusGeometry(4.3, 0.2, 8, 40);
      t.rotateX(Math.PI / 2);
      t.translate(16, y, -7.5);
      b.add(t, M.skCap);
    }
    b.add(cylGeo([16, 30.6, -7.5], [16, 31.7, -7.5], 3.15, 28), M.skLid);
    b.build(out.skG);
  }
  out.skFoam = mesh(new THREE.CylinderGeometry(1.3, 1.3, 12, 14), M.foam, out.skG);
  out.skFoam.position.set(16, 28.6, -7.5);
  out.skAirG = new THREE.Group();
  out.skVenG = new THREE.Group();
  out.skG.add(out.skAirG, out.skVenG);
  mesh(cylGeo([16, 0.8, -7.5], [16, 2.4, -7.5], 1.3, 12), M.airstone, out.skAirG);
  {
    /* tipe pompa venturi: pompa needle-wheel di dasar, selang udara + silencer ke atas */
    const b = new StaticBatch();
    b.add(boxGeo(17.2, 20.8, 0.2, 3.8, -10.4, -4.6), M.skCap);
    b.add(cylGeo([17.2, 2, -7.5], [16, 2, -7.5], 0.7, 12), M.skCap);
    b.add(cylGeo([19, 3.8, -7.5], [19, 4.6, -7.5], 0.6, 10), M.skCap);
    b.add(
      tubeGeo(
        [
          [19, 4.6, -7.5],
          [19.4, 12, -6.2],
          [19.6, 26, -5.6],
          [19.6, 31, -5.6],
        ],
        0.22,
      ),
      M.air,
    );
    b.add(cylGeo([19.6, 31, -5.6], [19.6, 33.8, -5.6], 0.55, 12), M.skCap);
    b.add(
      tubeGeo(
        [
          [20.8, 2, -6],
          [21.5, 6, -4],
          [21.8, 26, -3],
          [22.5, 31.5, -2.4],
          [48, 31.8, -2.2],
        ],
        0.18,
      ),
      M.dark,
    );
    b.build(out.skVenG);
  }

  /* media bio (ring keramik) — InstancedMesh, satu draw call */
  {
    const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.65, 0.65, 0.9, 10, 1, true), M.ring, 110);
    const o = new THREE.Object3D();
    for (let i = 0; i < 110; i++) {
      o.position.set(22.3 + rnd() * 13.4, 0.8 + rnd() * 11, -11.8 + rnd() * 8.6);
      o.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
    }
    scene.add(im);
  }

  /* pompa return + kabel listrik + pemanas */
  sb.add(boxGeo(42, 47, 0.3, 4.6, -10, -5.2), M.dark, { cast: true });
  sb.add(cylGeo([44.5, 2.4, -5.2], [44.5, 2.4, -4.2], 1.9, 20), M.dark);
  sb.add(cylGeo([44.5, 4.6, -7.5], [44.5, 6.2, -7.5], 0.95, 16), M.dark);
  sb.add(
    tubeGeo(
      [
        [46.5, 4, -10],
        [48.6, 10, -12],
        [48.8, 31, -12.2],
        [51.5, 31.5, -13.5],
        [53, 10, -14.5],
        [53.5, -0.4, -15],
      ],
      0.17,
    ),
    M.dark,
  );
  sb.add(boxGeo(48.7, 49.4, 17.1, 18.9, -5.2, -3.6), M.white);

  /* ATO: wadah, selang, tetesan */
  out.atoG = new THREE.Group();
  scene.add(out.atoG);
  {
    const b = new StaticBatch();
    b.add(cylGeo([62, -0.5, -6], [62, 13.5, -6], 5.6, 32), M.clear);
    b.add(cylGeo([62, 13.5, -6], [62, 14.1, -6], 5.8, 32), M.white);
    b.add(
      tubeGeo(
        [
          [62, 14.2, -6],
          [60, 20, -7],
          [54, 31, -10],
          [49, 32.5, -11],
          [47.5, 31, -11],
        ],
        0.22,
      ),
      M.air,
    );
    b.build(out.atoG);
  }
  out.atoW = mesh(new THREE.CylinderGeometry(5.3, 5.3, 1, 28), M.waterF, out.atoG);
  out.atoDrip = mesh(new THREE.CylinderGeometry(0.16, 0.16, 1, 8), M.stream, scene);
  out.atoDrip.visible = false;

  /* pompa udara + selang ke skimmer */
  out.airPumpG = new THREE.Group();
  scene.add(out.airPumpG);
  {
    const b = new StaticBatch();
    b.add(boxGeo(58, 66, -0.5, 3.2, 11, 16.5), M.pvcG, { cast: true });
    b.add(
      tubeGeo(
        [
          [60, 3.2, 13],
          [57, 7, 8],
          [53.5, 22, -6],
          [51, 31.6, -13.6],
          [32, 31.4, -13.9],
          [19.5, 31.4, -13.7],
          [17.6, 29.6, -10.8],
          [17.3, 25, -9.3],
          [16.8, 23, -8.6],
        ],
        0.2,
      ),
      M.air,
    );
    b.build(out.airPumpG);
  }

  /* saklar pelampung */
  out.fsHi = new THREE.Group();
  out.fsLo = new THREE.Group();
  scene.add(out.fsHi, out.fsLo);
  {
    const b = new StaticBatch();
    b.add(cylGeo([48.3, 27.6, 22.2], [48.3, 29.6, 22.2], 0.5, 12), M.white);
    b.add(cylGeo([48.3, 28.2, 22.2], [48.3, 28.8, 22.2], 0.85, 16), M.red);
    b.add(boxGeo(47.9, 49.5, 29.6, 30.3, 21.6, 22.8), M.dark);
    b.build(out.fsHi);
    const c = new StaticBatch();
    c.add(cylGeo([40.6, 3, -11.6], [40.6, 5, -11.6], 0.5, 12), M.white);
    c.add(cylGeo([40.6, 3.7, -11.6], [40.6, 4.3, -11.6], 0.85, 16), M.red);
    c.build(out.fsLo);
  }

  /* selang return + duckbill (bisa diarahkan) */
  mesh(tubeGeo(RETURN_PTS, 0.85, 16), M.hose, scene, { order: 5 });
  sb.add(sphereGeo([NOZZLE[0], NOZZLE[1], NOZZLE[2]], 1.15), M.dark);
  out.nozG = new THREE.Group();
  out.nozG.position.set(NOZZLE[0], NOZZLE[1], NOZZLE[2]);
  out.nozG.rotation.order = 'YZX';
  scene.add(out.nozG);
  {
    const g = new THREE.CylinderGeometry(1.7, 0.6, 3.6, 24);
    g.scale(0.36, 1, 1); // paruh pipih
    g.rotateZ(Math.PI / 2);
    g.translate(-2.5, 0, 0);
    const b = new StaticBatch();
    b.add(g, M.dark);
    b.add(cylGeo([-0.2, 0, 0], [-1.2, 0, 0], 0.75, 14), M.dark);
    b.build(out.nozG);
  }

  /* wavemaker (opsional) */
  out.wmG = new THREE.Group();
  out.wmG.position.set(WAVEMAKER.x, 16, WAVEMAKER.z);
  out.wmG.rotation.order = 'YZX';
  out.wmG.visible = false;
  scene.add(out.wmG);
  {
    const b = new StaticBatch();
    b.add(cylGeo([1.6, 0, 0], [-2.2, 0, 0], 2.1, 24), M.dark);
    b.add(cylGeo([-2.2, 0, 0], [-2.6, 0, 0], 2.3, 24), M.pvcG);
    b.add(sphereGeo([1.6, 0, 0], 2.1, 20, 14), M.dark);
    // kisi depan
    for (let k = -2; k <= 2; k++) b.add(boxGeo(-2.65, -2.55, -1.9, 1.9, k * 0.8 - 0.12, k * 0.8 + 0.12), M.dark);
    b.build(out.wmG);
  }
  out.wmMount = mesh(new THREE.BoxGeometry(0.4, 3, 3), M.dark, scene);
  out.wmMount.position.set(49.3, 16, 14);
  out.wmMount.visible = false;
  out.holeM = mesh(sphereGeo([44.5, GEO.ZHOLE, 2.55], 0.36), M.hole, scene);

  sb.build(scene);
  return out;
}
