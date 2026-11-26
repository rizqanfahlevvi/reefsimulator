/**
 * Desain 2 — model 3D: tank kaca, kotak dalam bersisir, kotak luar di balik kaca belakang, bulkhead
 * penghubung, tiga pipa Bean Animal (siphon + gate valve, jalur terbuka, darurat), return dengan
 * lubang pemutus siphon. Muka air tiap ruang dari hasil kalkulator (model.solve).
 *
 * Render sesuai kebutuhan (bukan tiap frame): hanya saat kamera bergerak atau angka berubah.
 * Koordinat cm: x sepanjang tank (tengah = 0), y dari dasar tank, z ke depan (+); kaca belakang di z = −D/2.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { boxGeo, cylGeo, tubeGeo } from '../render/geom.js';
import { geometry, BULKHEADS, flangeOf, breakHoleY } from './model.js';

const pipeOD = (size) => BULKHEADS[size].hole + 0.1;

/** Pelat bidang XY (tebal ke arah z) dengan lubang bulat & persegi. */
function slabXY(x0, x1, y0, y1, z0, z1, circles = [], rects = []) {
  const s = new THREE.Shape();
  s.moveTo(x0, y0);
  s.lineTo(x1, y0);
  s.lineTo(x1, y1);
  s.lineTo(x0, y1);
  s.closePath();
  for (const c of circles) {
    const h = new THREE.Path();
    h.absarc(c.x, c.y, c.r, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  for (const r of rects) {
    const h = new THREE.Path();
    h.moveTo(r.x0, r.y0);
    h.lineTo(r.x0, r.y1);
    h.lineTo(r.x1, r.y1);
    h.lineTo(r.x1, r.y0);
    h.closePath();
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: z1 - z0, bevelEnabled: false, curveSegments: 20 });
  g.translate(0, 0, z0);
  return g;
}
/** Pelat mendatar (tebal ke bawah dari yTop) dengan lubang bulat; bentuk digambar di bidang x–z. */
function slabXZ(x0, x1, z0, z1, yTop, t, circles = []) {
  const s = new THREE.Shape();
  s.moveTo(x0, z0);
  s.lineTo(x1, z0);
  s.lineTo(x1, z1);
  s.lineTo(x0, z1);
  s.closePath();
  for (const c of circles) {
    const h = new THREE.Path();
    h.absarc(c.x, c.z, c.r, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 20 });
  g.rotateX(Math.PI / 2); // (x, sy, d) → (x, −d, sy)
  g.translate(0, yTop, 0);
  return g;
}
/** Cincin datar (flens/mur) tegak lurus sumbu. */
function ringGeo(p0, p1, rOut, rIn, seg = 28) {
  const s = new THREE.Shape();
  s.absarc(0, 0, rOut, 0, Math.PI * 2, false);
  const h = new THREE.Path();
  h.absarc(0, 0, rIn, 0, Math.PI * 2, true);
  s.holes.push(h);
  const a = new THREE.Vector3(...p0);
  const b = new THREE.Vector3(...p1);
  const d = b.clone().sub(a);
  const g = new THREE.ExtrudeGeometry(s, { depth: d.length(), bevelEnabled: false, curveSegments: seg });
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

export function createD2Scene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.localClippingEnabled = true;
  container.insertBefore(renderer.domElement, container.firstChild);

  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  pm.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8070, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(40, 90, 60);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(35, 1, 1, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 15;
  controls.maxDistance = 400;

  const cut = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  const mats = [];
  const M = (m) => (mats.push(m), m);
  const mat = {
    glass: M(new THREE.MeshPhysicalMaterial({ color: 0xd6eeee, transparent: true, opacity: 0.14, roughness: 0.04, depthWrite: false, side: THREE.DoubleSide })),
    glassEdge: M(new THREE.LineBasicMaterial({ color: 0x5fb7c0, transparent: true, opacity: 0.85 })),
    acr: M(new THREE.MeshPhysicalMaterial({ color: 0x3a4046, transparent: true, opacity: 0.42, roughness: 0.18, depthWrite: false, side: THREE.DoubleSide })),
    acrEdge: M(new THREE.LineBasicMaterial({ color: 0x24282c, transparent: true, opacity: 0.7 })),
    water: M(new THREE.MeshPhysicalMaterial({ color: 0x3f9bd6, transparent: true, opacity: 0.26, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide })),
    surf: M(new THREE.MeshPhysicalMaterial({ color: 0x8fd0f2, transparent: true, opacity: 0.5, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide })),
    fall: M(new THREE.MeshBasicMaterial({ color: 0xcfeeff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })),
    pvc: M(new THREE.MeshStandardMaterial({ color: 0xf1f0ea, roughness: 0.42 })),
    pvcIn: M(new THREE.MeshStandardMaterial({ color: 0x6d6c66, roughness: 0.8, side: THREE.BackSide })),
    blk: M(new THREE.MeshStandardMaterial({ color: 0x1e2124, roughness: 0.45 })),
    bh: M(new THREE.MeshStandardMaterial({ color: 0x2d3135, roughness: 0.55 })),
    red: M(new THREE.MeshStandardMaterial({ color: 0xc8382c, roughness: 0.5 })),
    hole: M(new THREE.MeshBasicMaterial({ color: 0x111111 })),
    stand: M(new THREE.MeshStandardMaterial({ color: 0x3d3733, roughness: 0.7 })),
  };

  const rig = new THREE.Group();
  const wet = new THREE.Group();
  scene.add(rig, wet);
  let G = null;
  let geoKey = '';
  let cutOn = false;
  let view = 'iso';
  const labels = [];
  let showLabels = true;
  const lblLayer = document.createElement('div');
  lblLayer.className = 'd2-labels';
  container.appendChild(lblLayer);

  const clear = (grp) => {
    for (const o of [...grp.children]) {
      grp.remove(o);
      o.traverse((c) => c.geometry && c.geometry.dispose());
    }
  };
  const add = (grp, geo, m, order) => {
    const o = new THREE.Mesh(geo, m);
    if (order !== undefined) o.renderOrder = order;
    grp.add(o);
    return o;
  };
  const edges = (grp, geo, m) => grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), m));

  /* ---------------- bangun rangka (berubah hanya bila ukuran berubah) ---------------- */
  function build(g) {
    clear(rig);
    lblLayer.textContent = '';
    labels.length = 0;
    const p = g.p;
    const W = p.tankW;
    const D = p.tankD;
    const H = p.tankH;
    const gt = p.glassT;
    const t = p.acrT;
    const X = (x) => x - W / 2;
    const zBo = -D / 2; // muka luar kaca belakang
    const zBi = -D / 2 + p.backT; // muka dalam
    const label = (text, pos, cls = '') => {
      const el = document.createElement('div');
      el.className = 'd2-lbl ' + cls;
      el.textContent = text;
      lblLayer.appendChild(el);
      labels.push({ el, v: new THREE.Vector3(...pos) });
    };

    // meja/lemari di bawah tank
    add(rig, boxGeo(-W / 2 - 2, W / 2 + 2, -3, 0, -D / 2, D / 2 + 2), mat.stand);

    // kaca
    const holesBack = [...g.holesX.map((x) => ({ x: X(x), y: p.holeY, r: g.holeD / 2 })), ...g.retX.map((x) => ({ x: X(x), y: g.retY, r: g.retHoleD / 2 }))];
    const panes = [
      boxGeo(-W / 2, W / 2, 0, gt, zBi, D / 2), // dasar
      boxGeo(-W / 2, W / 2, gt, H, D / 2 - gt, D / 2), // depan
      boxGeo(-W / 2, -W / 2 + gt, gt, H, zBi, D / 2 - gt), // kiri
      boxGeo(W / 2 - gt, W / 2, gt, H, zBi, D / 2 - gt), // kanan
      slabXY(-W / 2, W / 2, 0, H, zBo, zBi, holesBack), // belakang (dibor)
    ];
    for (const geo of panes) {
      add(rig, geo, mat.glass, 2);
      edges(rig, geo, mat.glassEdge);
    }

    // kotak dalam bersisir
    const x0 = X(g.x0);
    const x1 = X(g.x1);
    const zi0 = zBi;
    const zi1 = zBi + p.inW;
    const slots = [];
    for (let i = 0; i < g.nSlots; i++) {
      const sx = X(g.slotX0) + i * p.slotPitch;
      slots.push({ x0: sx, x1: sx + p.slotW, y0: g.slotBot, y1: g.slotTop });
    }
    const conn = g.holesX.map((x) => ({ x: X(x), y: p.holeY, r: g.holeD / 2 }));
    const inner = [
      slabXY(x0, x1, g.inBot, H, zi1 - t, zi1, [], slots), // depan bersisir
      slabXY(x0, x1, g.inBot, H, zi0, zi0 + t, conn), // belakang (menempel kaca)
      boxGeo(x0, x0 + t, g.inBot, H, zi0 + t, zi1 - t),
      boxGeo(x1 - t, x1, g.inBot, H, zi0 + t, zi1 - t),
      boxGeo(x0 + t, x1 - t, g.inBot, g.inBot + t, zi0 + t, zi1 - t),
    ];
    for (const geo of inner) {
      add(rig, geo, mat.acr, 3);
      edges(rig, geo, mat.acrEdge);
    }
    label('Kotak sisir', [x1 + 2, H + 1.5, zi1 + 1]);

    // kotak luar
    const zo1 = zBo;
    const zo0 = zBo - p.outW;
    const yo = g.outBot;
    const floorHoles = g.drains.map((d) => ({ x: X(d.x), z: (zo0 + zo1) / 2, r: BULKHEADS[d.size].hole / 2 }));
    const outer = [
      slabXY(x0, x1, yo, H, zo1 - t, zo1, conn),
      boxGeo(x0, x1, yo, H, zo0, zo0 + t),
      boxGeo(x0, x0 + t, yo + t, H, zo0 + t, zo1 - t),
      boxGeo(x1 - t, x1, yo + t, H, zo0 + t, zo1 - t),
      slabXZ(x0 + t, x1 - t, zo0 + t, zo1 - t, yo + t, t, floorHoles),
    ];
    for (const geo of outer) {
      add(rig, geo, mat.acr, 3);
      edges(rig, geo, mat.acrEdge);
    }
    label('Kotak luar', [x0 - 2, H + 1.5, zo0]);

    // bulkhead penghubung: ulir menembus kotak dalam – kaca – kotak luar; flens di dalam, mur di luar
    for (const c of conn) {
      const r = c.r;
      const fl = flangeOf(p.holeSize) / 2;
      const zA = zi0 + t;
      const zB = zo1 - t;
      add(rig, cylGeo([c.x, c.y, zB - 0.4], [c.x, c.y, zA + 0.6], r, 24, r, true), mat.bh);
      add(rig, cylGeo([c.x, c.y, zB - 0.4], [c.x, c.y, zA + 0.6], g.holeBore / 2, 24, g.holeBore / 2, true), mat.pvcIn);
      add(rig, ringGeo([c.x, c.y, zA], [c.x, c.y, zA + 0.6], fl, g.holeBore / 2), mat.bh);
      add(rig, ringGeo([c.x, c.y, zB - 0.8], [c.x, c.y, zB], fl * 0.95, r, 6), mat.bh);
    }
    label('Lubang penghubung', [conn[0].x, p.holeY + 2.5, zBo + 0.5], 'sm');

    // Bean Animal
    const zc = (zo0 + zo1) / 2;
    const yEnd = Math.min(-2, yo - 24);
    const fi = g.floorIn;
    for (const d of g.drains) {
      const x = X(d.x);
      const ro = pipeOD(d.size) / 2;
      const ri = BULKHEADS[d.size].bore / 2;
      const fl = flangeOf(d.size) / 2;
      // flens di atas alas, mur di bawah
      add(rig, ringGeo([x, fi, zc], [x, fi + 0.6, zc], fl, ri), mat.bh);
      add(rig, ringGeo([x, yo - 0.9, zc], [x, yo, zc], fl * 0.95, ro, 6), mat.bh);
      // pipa ke sump di bawah alas
      add(rig, cylGeo([x, yEnd, zc], [x, yo - 0.9, zc], ro, 20), mat.pvc);
      if (d.key === 'main') {
        // siphon: naik, belok 180° menghadap bawah, mulut di atas alas
        const R = Math.max(1.2, ro * 1.25);
        const yU = g.mainInlet + 2.2;
        const xd = x + 2 * R;
        const pts = [
          [x, fi + 0.6, zc],
          [x, (fi + yU) / 2, zc],
          [x, yU, zc],
        ];
        for (let k = 1; k < 8; k++) {
          const a = Math.PI - (Math.PI * k) / 8;
          pts.push([x + R + R * Math.cos(a), yU + R * Math.sin(a), zc]);
        }
        pts.push([xd, yU, zc], [xd, (yU + g.mainInlet) / 2, zc], [xd, g.mainInlet, zc]);
        add(rig, tubeGeo(pts, ro, 16), mat.pvc);
        add(rig, ringGeo([xd, g.mainInlet - 0.02, zc], [xd, g.mainInlet + 0.02, zc], ro, ri), mat.pvc);
        add(rig, cylGeo([xd, g.mainInlet, zc], [xd, g.mainInlet + 0.8, zc], ri, 20, ri, true), mat.pvcIn);
        // gate valve
        const yv = yo - 9;
        add(rig, boxGeo(x - ro * 1.6, x + ro * 1.6, yv - 2.2, yv + 2.2, zc - ro * 1.5, zc + ro * 1.5), mat.blk);
        add(rig, cylGeo([x, yv, zc - ro * 1.5], [x, yv, zc - ro * 1.5 - 2.5], 0.35, 10), mat.blk);
        const wheel = new THREE.TorusGeometry(1.6, 0.32, 8, 24);
        wheel.translate(x, yv, zc - ro * 1.5 - 2.6);
        add(rig, wheel, mat.red);
        label('Siphon + gate valve', [x - 2, yv - 5, zc - 3]);
      } else {
        const top = d.top;
        add(rig, cylGeo([x, fi + 0.6, zc], [x, top, zc], ro, 20, ro, true), mat.pvc);
        add(rig, cylGeo([x, fi + 0.6, zc], [x, top, zc], ri, 20, ri, true), mat.pvcIn);
        add(rig, ringGeo([x, top - 0.02, zc], [x, top + 0.02, zc], ro, ri), mat.pvc);
        label(d.key === 'open' ? 'Jalur terbuka' : 'Darurat', [x, d.key === 'open' ? yo - 4 : yo - 15, zc], 'sm');
      }
    }
    label('↓ ke sump (menyusul)', [X(g.drains[1].x), yEnd - 6, zc], 'mut');

    // return: bulkhead + siku hitam; dalam: nozzle loc-line ke bawah, luar: pipa turun dari pompa
    const rr = BULKHEADS[p.retSize].hole / 2 + 0.1;
    for (const xr of g.retX) {
      const x = X(xr);
      const y = g.retY;
      add(rig, cylGeo([x, y, zBo - 1.4], [x, y, zBi + 1.2], BULKHEADS[p.retSize].hole / 2, 20), mat.bh);
      add(rig, ringGeo([x, y, zBi], [x, y, zBi + 0.6], flangeOf(p.retSize) / 2, rr * 0.7), mat.bh);
      add(rig, ringGeo([x, y, zBo - 0.8], [x, y, zBo], (flangeOf(p.retSize) / 2) * 0.95, rr, 6), mat.bh);
      const tipY = y - p.tipDrop;
      const pin = [
        [x, y, zBi + 1.2],
        [x, y, zBi + 2.6],
        [x, y - 0.6, zBi + 3.8],
        [x, (y + tipY) / 2 - 0.4, zBi + 4.6],
        [x, tipY + 0.8, zBi + 5.2],
      ];
      add(rig, tubeGeo(pin, rr * 0.8, 14), mat.blk);
      for (let k = 1; k < 4; k++) {
        const a = pin[k];
        add(rig, new THREE.SphereGeometry(rr * 0.95, 14, 10).translate(a[0], a[1], a[2]), mat.blk);
      }
      add(rig, cylGeo([x, tipY + 0.8, zBi + 5.2], [x, tipY, zBi + 5.6], rr * 0.8, 14, rr * 0.45), mat.blk);
      const pout = [
        [x, y, zBo - 1.4],
        [x, y, zBo - 3],
        [x, y - 1.6, zBo - 4.2],
        [x, y - 4, zBo - 4.4],
        [x, yEnd, zBo - 4.4],
      ];
      add(rig, tubeGeo(pout, rr, 14), mat.blk);
    }
    label(p.breakHole ? 'Return + lubang pemutus siphon' : 'Return (tanpa pemutus siphon!)', [X(g.retX[1]), g.retY + 4, zBi + 3], p.breakHole ? 'sm' : 'warn');

    applyCut();
  }

  /* ---------------- air (berubah tiap kali angka berubah) ---------------- */
  function water(g, s) {
    clear(wet);
    const p = g.p;
    const W = p.tankW;
    const D = p.tankD;
    const gt = p.glassT;
    const t = p.acrT;
    const X = (x) => x - W / 2;
    const zBi = -D / 2 + p.backT;
    const zBo = -D / 2;
    const zF = D / 2 - gt;
    const xa = -W / 2 + gt;
    const xb = W / 2 - gt;
    const x0 = X(g.x0);
    const x1 = X(g.x1);
    const zi1 = zBi + p.inW;
    const h = Math.min(s.hTank, p.tankH);
    const box = (a, b, c, d, e, f, top = true) => {
      if (d - c < 0.05) return;
      add(wet, boxGeo(a, b, c, d, e, f), mat.water, 1);
      if (top) add(wet, new THREE.PlaneGeometry(b - a, f - e).rotateX(-Math.PI / 2).translate((a + b) / 2, d + 0.01, (e + f) / 2), mat.surf, 1);
    };
    // tank: di bawah kotak dalam penuh; di atasnya air mengelilingi kotak (depan, kiri, kanan)
    box(xa, xb, gt, g.inBot, zBi, zF, false);
    box(xa, xb, g.inBot, h, zi1, zF);
    box(xa, x0, g.inBot, h, zBi, zi1);
    box(x1, xb, g.inBot, h, zBi, zi1);
    // kotak dalam
    box(x0 + t, x1 - t, g.inBot + t, Math.min(s.hIn, p.tankH), zBi + t, zi1 - t);
    // tirai air terjun di balik sisir
    if (s.hIn < g.slotBot - 0.2 && s.Q > 0) {
      const y0 = Math.max(s.hIn, g.inBot + t);
      const fall = new THREE.PlaneGeometry(g.slotSpan, g.slotBot - y0);
      fall.translate(X(g.slotX0) + g.slotSpan / 2, (g.slotBot + y0) / 2, zi1 - t - 0.35);
      add(wet, fall, mat.fall, 4);
    }
    // kotak luar
    box(x0 + t, x1 - t, g.floorIn, Math.min(s.hOut, p.tankH), zBo - p.outW + t, zBo - t);
    // lubang pemutus siphon (Ø4 mm, ±1 cm di bawah muka air): di puncak siku atau di sisi depan pipa turun
    if (p.breakHole) {
      const rr = BULKHEADS[p.retSize].hole / 2 + 0.1;
      const by = breakHoleY(p);
      for (const xr of g.retX) {
        const atTop = by >= g.retY + rr * 0.5;
        add(wet, new THREE.SphereGeometry(0.3, 10, 8).translate(X(xr), atTop ? g.retY + rr * 0.8 : by, atTop ? zBi + 2.2 : zBi + 4.4 + rr * 0.8), mat.hole);
      }
    }
    applyCut();
    req();
  }

  /* ---------------- kamera ---------------- */
  function fitView(name) {
    if (!G) return;
    view = name;
    const p = G.p;
    const W = p.tankW;
    const D = p.tankD;
    const H = p.tankH;
    const zBo = -D / 2;
    const presets = {
      iso: { dir: [0.8, 0.55, -1], tgt: [0, H * 0.42, -p.outW * 0.3], r: 0.5 * Math.hypot(W, H + 26, D + p.outW) },
      front: { dir: [0, 0.12, 1], tgt: [0, H * 0.5, 0], r: 0.5 * Math.hypot(W, H + 6) },
      back: { dir: [-0.65, 0.42, -1], tgt: [0, G.outBot - 2, zBo - p.outW / 2], r: 0.5 * Math.hypot(p.L + 22, H - G.outBot + 34) },
      side: { dir: [1, 0.1, 0.04], tgt: [G.holesX[G.holesX.length - 1] - W / 2, (G.outBot - 12 + H) / 2, zBo + (p.inW - p.outW) / 2], r: 0.5 * Math.hypot(p.inW + p.outW + 20, H - G.outBot + 26) },
      top: { dir: [0, 1, 0.0001], tgt: [0, 0, -p.outW / 2], r: 0.5 * Math.hypot(W + 4, D + p.outW + 4) },
    };
    const v = presets[name] || presets.iso;
    const dir = new THREE.Vector3(...v.dir).normalize();
    const vf = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hf = Math.atan(Math.tan(vf) * camera.aspect);
    const dist = (v.r / Math.sin(Math.min(vf, hf))) * 1.02;
    controls.target.set(...v.tgt);
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    camera.near = Math.max(0.5, dist / 200);
    camera.far = dist * 6;
    camera.updateProjectionMatrix();
    controls.update();
    setCut(name === 'side', true);
    req();
  }
  function applyCut() {
    if (!G) return;
    // potongan melalui pusat lubang penghubung paling kanan (bulkhead terbelah dua)
    cut.constant = G.holesX[G.holesX.length - 1] - G.p.tankW / 2;
    for (const m of mats) {
      const want = cutOn ? [cut] : null;
      if ((m.clippingPlanes?.length || 0) !== (want?.length || 0)) {
        m.clippingPlanes = want;
        m.needsUpdate = true;
      }
    }
  }
  function setCut(on, quiet) {
    cutOn = !!on;
    applyCut();
    if (!quiet) req();
  }

  /* ---------------- render sesuai kebutuhan ---------------- */
  let raf = 0;
  const v3 = new THREE.Vector3();
  function placeLabels() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    lblLayer.hidden = !showLabels;
    if (!showLabels) return;
    for (const l of labels) {
      v3.copy(l.v);
      const hidden = cutOn && l.v.x > cut.constant;
      v3.project(camera);
      const vis = !hidden && v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05;
      l.el.style.display = vis ? '' : 'none';
      if (vis) l.el.style.transform = `translate(${((v3.x + 1) / 2) * w}px, ${((1 - v3.y) / 2) * h}px) translate(-50%, -50%)`;
    }
  }
  function frame() {
    raf = 0;
    const moving = controls.update();
    renderer.render(scene, camera);
    placeLabels();
    if (moving) req();
  }
  function req() {
    if (!raf) raf = requestAnimationFrame(frame);
  }
  controls.addEventListener('change', req);
  controls.addEventListener('start', req);

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    req();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  return {
    /** Perbarui rangka (bila ukuran berubah) dan air. */
    update(p, s) {
      const g = geometry(p);
      const key = JSON.stringify({ ...g.p, Q: 0, gate: 0, sumpDrop: 0, pipeLen: 0 });
      const first = !G;
      G = g;
      if (key !== geoKey) {
        geoKey = key;
        build(g);
      }
      water(g, s);
      if (first) fitView(view);
    },
    setView: fitView,
    setCut,
    get cut() {
      return cutOn;
    },
    setLabels(on) {
      showLabels = !!on;
      req();
    },
    render: req,
  };
}
