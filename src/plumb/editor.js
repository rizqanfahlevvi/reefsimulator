/**
 * Integrasi rakit pipa ke tampilan 3D: membangun mesh tiap bagian dari model (mm → cm),
 * sorotan bagian terpilih, penanda ujung bebas (HTML), pemilihan dengan ketukan, grid lantai,
 * dan sembunyikan/tampilkan tank acuan (lewat layer kamera, tidak mengubah visibilitas benda lain).
 * Fase 2/3: bagian yang menabrak diwarnai merah, garis ukur 3D + label, label kecepatan di pipa,
 * dan tanda ujung masuk (pompa) / keluar untuk perhitungan hidrolik.
 */
import * as THREE from 'three';
import { frames, freePorts } from './model.js';
import { partGeometry } from './geometry.js';
import { COLORS, SIZES, END_LABEL } from './catalog.js';
import { createHotHighlight } from '../render/hotspots.js';
import { rayObstacle } from './collide.js';
import { el, $ } from '../util/format.js';

const LAYER = 1; // tetap terlihat saat tank acuan disembunyikan
const sameEnd = (a, b) => !!a && !!b && a.pid === b.pid && a.port === b.port;

/**
 * @param {{world: any, onPickPart: (id:number|null) => void, onPickPort: (pid:number, port:number) => void, onPickPoint?: (pt: {p: number[], label: string}) => void}} ctx
 */
export function createPlumbEditor({ world, onPickPart, onPickPort, onPickPoint }) {
  const { scene, camera } = world;
  const canvas = world.renderer.domElement;
  world.enableRefLayer();

  // rakitan dalam mm → grup diskala 0,1 supaya cocok dengan scene (cm)
  const root = new THREE.Group();
  root.scale.setScalar(0.1);
  root.visible = false;
  scene.add(root);
  const grid = new THREE.GridHelper(140, 28, 0x7b8a99, 0xb9c3cc);
  grid.position.set(25, 0.03, 0);
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  grid.visible = false;
  grid.layers.enable(LAYER);
  scene.add(grid);
  const hl = createHotHighlight(scene, LAYER);

  /* material per warna (dibagi antar bagian) */
  const mats = {};
  for (const [k, c] of Object.entries(COLORS)) {
    const base = { color: c.hex, roughness: c.clear ? 0.08 : 0.42, metalness: 0, envMap: world.ctx.envTex, envMapIntensity: c.clear ? 1.2 : 0.6 };
    mats[k] = {
      body: new THREE.MeshStandardMaterial(c.clear ? { ...base, transparent: true, opacity: 0.38, depthWrite: false } : base),
      thread: new THREE.MeshStandardMaterial(
        c.clear ? { ...base, transparent: true, opacity: 0.5, depthWrite: false } : { ...base, color: new THREE.Color(c.hex).multiplyScalar(0.82) },
      ),
    };
  }
  const nut = new THREE.MeshStandardMaterial({ color: 0x3c4146, roughness: 0.5, metalness: 0, envMap: world.ctx.envTex, envMapIntensity: 0.4 });
  const handle = new THREE.MeshStandardMaterial({ color: 0xd23a35, roughness: 0.45, metalness: 0, envMap: world.ctx.envTex, envMapIntensity: 0.5 });
  const matFor = (color, key) => (key === 'nut' ? nut : key === 'handle' ? handle : mats[color]?.[key] || mats.abu[key]);
  // bagian yang menabrak kaca/bagian lain
  const hitMat = new THREE.MeshStandardMaterial({ color: 0xd83b30, roughness: 0.5, metalness: 0, emissive: 0x5a0d08, transparent: true, opacity: 0.85 });
  let hitSet = new Set();

  /* geometri di-cache per bentuk (jenis+ukuran+panjang), dibuang bila tidak dipakai lagi */
  const cache = new Map();
  const geoKey = (p) => [p.type, p.size, p.sizeB || '', p.cls, p.type === 'pipe' ? p.len : ''].join('|');

  let design = null;
  let fr = new Map();
  let free = [];
  const boxes = new Map(); // id → Box3 (cm) untuk memilih dengan ketukan
  let selPart = null;
  let selPort = null;

  function rebuild(d) {
    design = d;
    fr = frames(d);
    free = freePorts(d, fr);
    for (const c of [...root.children]) root.remove(c);
    const used = new Set();
    boxes.clear();
    for (const p of d.parts) {
      const f = fr.get(p.id);
      if (!f) continue;
      const k = geoKey(p);
      used.add(k);
      if (!cache.has(k)) cache.set(k, partGeometry(p));
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      g.matrix.copy(f.m);
      g.userData.pid = p.id;
      for (const { geo, mat } of cache.get(k)) {
        const m = new THREE.Mesh(geo, hitSet.has(p.id) ? hitMat : matFor(p.color, mat));
        m.userData.mat = matFor(p.color, mat);
        m.castShadow = !COLORS[p.color]?.clear;
        m.layers.enable(LAYER);
        m.renderOrder = COLORS[p.color]?.clear ? 6 : 0;
        g.add(m);
      }
      root.add(g);
    }
    for (const [k, list] of cache)
      if (!used.has(k)) {
        for (const { geo } of list) geo.dispose();
        cache.delete(k);
      }
    root.updateMatrixWorld(true);
    for (const g of root.children) boxes.set(g.userData.pid, new THREE.Box3().setFromObject(g));
    world.ctx.markShadowsDirty();
    refreshHighlight();
  }

  function refreshHighlight() {
    const b = selPart != null ? boxes.get(selPart) : null;
    hl.set(b ? [[b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z]] : null);
  }

  /** Kotak seluruh rakitan (cm). */
  function bounds() {
    const b = new THREE.Box3();
    for (const x of boxes.values()) b.union(x);
    return b;
  }

  /* ---------- penanda ujung bebas (HTML) ---------- */
  const layer = el('div', { id: 'plumbLayer', hidden: true });
  $('view').append(layer);
  let markers = [];
  function syncMarkers() {
    const want = free.length;
    while (markers.length < want) {
      const b = el('button', { className: 'pport', type: 'button' });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const m = markers.find((x) => x.el === b);
        if (m?.port) onPickPort(m.port.pid, m.port.port);
      });
      layer.append(b);
      markers.push({ el: b, x: -1, y: -1 });
    }
    markers.forEach((m, i) => {
      m.port = free[i] || null;
      m.el.hidden = !m.port;
      if (m.port) {
        m.el.title = `${END_LABEL[m.port.end]} ${SIZES[m.port.size].label}`;
        m.el.ariaLabel = 'Sambung ke ' + m.el.title;
        m.el.classList.toggle('sel', !!selPort && selPort.pid === m.port.pid && selPort.port === m.port.port);
        m.el.dataset.end = m.port.end;
        m.el.dataset.role = roleOf(m.port);
      }
    });
  }

  const v = new THREE.Vector3();
  function placeMarkers() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    for (const m of markers) {
      if (!m.port) continue;
      // sedikit di luar mulut sok supaya tidak tertutup badannya
      v.copy(m.port.p).addScaledVector(m.port.d, 6).multiplyScalar(0.1).project(camera);
      const vis = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      if (m.el.hidden === vis) m.el.hidden = !vis;
      if (!vis) continue;
      const x = Math.round(((v.x + 1) / 2) * w);
      const y = Math.round(((1 - v.y) / 2) * h);
      if (x !== m.x || y !== m.y) {
        m.x = x;
        m.y = y;
        m.el.style.transform = `translate(${x}px, ${y}px)`;
      }
    }
  }

  /* ---------- ketuk bagian (bukan seret/putar) ---------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const down = new Map();
  let active = false;
  canvas.addEventListener('pointerdown', (e) => active && down.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() }));
  canvas.addEventListener('pointerup', (e) => {
    const d = down.get(e.pointerId);
    down.delete(e.pointerId);
    if (!active || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 7 || performance.now() - d.t > 450) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // kotak tiap bagian diperbesar 0,6 cm → pipa tipis tetap mudah diketuk di HP
    let best = null;
    let bestD = Infinity;
    const hit = new THREE.Vector3();
    for (const [id, b] of boxes) {
      const bb = b.clone().expandByScalar(0.6);
      if (ray.ray.intersectBox(bb, hit)) {
        const dist = hit.distanceTo(ray.ray.origin);
        if (dist < bestD) {
          bestD = dist;
          best = id;
        }
      }
    }
    if (best == null && measuring && onPickPoint) {
      // alat ukur: titik di kaca/meja bila tidak mengenai bagian
      const o = rayObstacle(ray.ray);
      if (o) return onPickPoint({ p: [o.p.x * 10, o.p.y * 10, o.p.z * 10], label: o.name });
    }
    onPickPart(best);
  });

  /* ---------- garis ukur (cm, langsung di scene) ---------- */
  let measuring = false;
  const mg = new THREE.Group();
  mg.visible = false;
  scene.add(mg);
  const onTop = (o) => {
    o.renderOrder = 30;
    o.layers.enable(LAYER);
    return o;
  };
  const lineMat = new THREE.LineDashedMaterial({ color: 0xe0a400, dashSize: 0.8, gapSize: 0.45, depthTest: false, transparent: true });
  const legMats = [0xd8433a, 0x2f9e44, 0x2a78d6].map((c) => new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.85 }));
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xe0a400, depthTest: false, transparent: true });
  const dotGeo = new THREE.SphereGeometry(0.32, 14, 10);
  let measure = [];
  function drawMeasure() {
    for (const c of [...mg.children]) {
      mg.remove(c);
      if (c.geometry !== dotGeo) c.geometry?.dispose();
    }
    const pts = measure.map((m) => new THREE.Vector3(...m.p).multiplyScalar(0.1));
    for (const p of pts) mg.add(onTop(new THREE.Mesh(dotGeo, dotMat)).translateX(p.x).translateY(p.y).translateZ(p.z));
    if (pts.length === 2) {
      const [a, b] = pts;
      const main = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), lineMat);
      main.computeLineDistances();
      mg.add(onTop(main));
      // kaki sumbu: x (merah) → y (hijau) → z (biru), seperti garis dimensi
      const c1 = new THREE.Vector3(b.x, a.y, a.z);
      const c2 = new THREE.Vector3(b.x, b.y, a.z);
      [[a, c1], [c1, c2], [c2, b]].forEach(([u, w], i) => {
        if (u.distanceToSquared(w) > 1e-6) mg.add(onTop(new THREE.Line(new THREE.BufferGeometry().setFromPoints([u, w]), legMats[i])));
      });
    }
    mg.visible = active && pts.length > 0;
  }

  /* ---------- label HTML di 3D (ukur, kecepatan) ---------- */
  let labels = [];
  function setLabelList(list) {
    for (const l of labels) l.el.remove();
    labels = list.map((x) => {
      const e = el('div', { className: 'plabel' + (x.cls ? ' ' + x.cls : ''), textContent: x.text });
      layer.append(e);
      return { el: e, p: new THREE.Vector3(...x.p), x: -1, y: -1 };
    });
  }
  let measureLabel = [];
  let speedLabels = [];
  const refreshLabels = () => setLabelList([...speedLabels, ...measureLabel]);
  function placeLabels() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    for (const l of labels) {
      v.copy(l.p).multiplyScalar(0.1).project(camera);
      const vis = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      if (l.el.hidden === vis) l.el.hidden = !vis;
      if (!vis) continue;
      const x = Math.round(((v.x + 1) / 2) * w);
      const y = Math.round(((1 - v.y) / 2) * h);
      if (x !== l.x || y !== l.y) {
        l.x = x;
        l.y = y;
        l.el.style.transform = `translate(${x}px, ${y}px)`;
      }
    }
  }
  let roles = { inlet: null, outlet: null };
  const roleOf = (port) => (sameEnd(port, roles.inlet) ? 'in' : sameEnd(port, roles.outlet) ? 'out' : '');

  return {
    rebuild,
    bounds,
    get design() {
      return design;
    },
    get frames() {
      return fr;
    },
    get free() {
      return free;
    },
    select(part, port) {
      selPart = part ?? null;
      selPort = port ?? null;
      refreshHighlight();
      syncMarkers();
    },
    /** Warnai merah bagian yang menabrak (id). */
    setCollisions(ids) {
      hitSet = new Set(ids);
      for (const g of root.children) for (const m of g.children) m.material = hitSet.has(g.userData.pid) ? hitMat : m.userData.mat;
    },
    /** Mode ukur: ketukan di kaca/meja juga menjadi titik. */
    setMeasuring(on) {
      measuring = !!on;
    },
    /** Titik ukur [{p: [x,y,z] mm, label}] (0–2) + teks label di tengah garis. */
    setMeasure(points, text) {
      measure = points.slice(0, 2);
      drawMeasure();
      measureLabel =
        measure.length === 2 && text ? [{ p: measure[0].p.map((x, i) => (x + measure[1].p[i]) / 2), text, cls: 'plabel-m' }] : [];
      refreshLabels();
    },
    /** Label kecepatan [{p: [x,y,z] mm, text, cls?}]. */
    setSpeedLabels(list) {
      speedLabels = list || [];
      refreshLabels();
    },
    /** Tandai ujung masuk (pompa) & keluar untuk hidrolik. */
    setRoles(r) {
      roles = { inlet: r?.inlet || null, outlet: r?.outlet || null };
      syncMarkers();
    },
    /** Masuk/keluar mode rakit. */
    show(on) {
      active = on;
      root.visible = on;
      grid.visible = on;
      layer.hidden = !on;
      mg.visible = on && measure.length > 0;
      if (!on) {
        hl.set(null);
        camera.layers.set(0);
      } else refreshHighlight();
    },
    /** Tank & filter sebagai acuan: tampil (layer 0) atau hanya rakitan + ruangan (layer 1). */
    setReference(visible) {
      camera.layers.set(visible ? 0 : LAYER);
    },
    /** Arahkan kamera ke seluruh rakitan. */
    focus() {
      const b = bounds();
      if (b.isEmpty()) return;
      const c = b.getCenter(new THREE.Vector3());
      const radius = b.getSize(new THREE.Vector3()).length() / 2;
      const ctrl = world.ctx.controls;
      const dir = camera.position.clone().sub(ctrl.target).normalize();
      // jarak supaya bola pembungkus rakitan muat di sudut pandang tersempit (tegak/mendatar)
      const vf = (camera.fov * Math.PI) / 360;
      const hf = Math.atan(Math.tan(vf) * camera.aspect);
      const dist = (radius * 1.15) / Math.sin(Math.min(vf, hf));
      ctrl.target.copy(c);
      camera.position.copy(c).addScaledVector(dir, Math.min(ctrl.maxDistance, Math.max(ctrl.minDistance, dist)));
      ctrl.update();
    },
    frame(t) {
      if (!active) return;
      syncMarkersOnce();
      placeMarkers();
      if (labels.length) placeLabels();
      hl.tick(t);
    },
  };

  function syncMarkersOnce() {
    if (markers.length < free.length || markers.some((m, i) => m.port !== (free[i] || null))) syncMarkers();
  }
}
