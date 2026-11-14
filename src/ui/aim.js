/**
 * Tahap 2: seret untuk mengarahkan duckbill/wavemaker langsung di tampilan 3D.
 *
 *  - Bola biru di ujung panah (atau badan duckbill) diseret → arah jet mengikuti jari: titik di
 *    bawah jari diproyeksikan ke bidang layar yang melewati bola, lalu arah = titik − titik putar.
 *  - Badan wavemaker diseret → tingginya bergeser di kaca kanan.
 *
 * Nilai dikirim ke slider panel (event input/change), sama seperti slider & kartu, sehingga
 * parameter, 3D, CFD, metrik, analisis, simpan otomatis, dan log berubah lewat satu jalur.
 * Listener pointerdown dipasang di fase capture: berjalan sebelum OrbitControls, dan hanya
 * mengambil alih bila jari mengenai pegangan — selain itu kamera tetap bisa diputar.
 */
import * as THREE from 'three';
import { app } from '../state.js';
import { AIM, aimAngles, aimGeometry, hotBoxes, pickHot } from '../render/hotspots.js';
import { el, $ } from '../util/format.js';

/** Radius sentuh bola pegangan (px). */
export const KNOB_PX = 28;

/**
 * @param {{world: any, getCurrent: () => string|null, onChange?: (key: string) => void}} ctx
 */
export function createAim({ world, getCurrent, onChange }) {
  const canvas = world.renderer.domElement;
  const camera = world.camera;
  const controls = world.ctx.controls;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const box = new THREE.Box3();
  const label = el('div', { id: 'aimLabel', hidden: true });
  $('view').append(label);
  let drag = null;

  const usable = (key) => key && AIM[key] && !(key === 'wm' && !app.V.wm);

  function toRay(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return r;
  }
  function knobDistancePx(key, e, r) {
    const k = aimGeometry(app, key).knob;
    tmp.set(k[0], k[1], k[2]).project(camera);
    if (tmp.z > 1) return Infinity;
    return Math.hypot(r.left + ((tmp.x + 1) / 2) * r.width - e.clientX, r.top + ((1 - tmp.y) / 2) * r.height - e.clientY);
  }
  function onBody(key) {
    for (const b of hotBoxes(app)[key]) {
      box.min.set(b[0], b[2], b[4]);
      box.max.set(b[1], b[3], b[5]);
      if (ray.ray.intersectBox(box, hit)) return true;
    }
    return false;
  }
  /** Nilai ke slider panel; true bila berubah. */
  function setPanel(id, v) {
    const src = $(id);
    if (!src || +src.value === v) return false;
    src.value = v;
    src.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  function showLabel(text, e) {
    const r = $('view').getBoundingClientRect();
    label.textContent = text;
    label.hidden = false;
    label.style.transform = `translate(${Math.round(e.clientX - r.left)}px, ${Math.round(e.clientY - r.top - 44)}px)`;
  }

  canvas.addEventListener(
    'pointerdown',
    (e) => {
      const key = getCurrent();
      if (drag || !usable(key) || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const spec = AIM[key];
      const r = toRay(e);
      let mode = null;
      if (knobDistancePx(key, e, r) < KNOB_PX) mode = 'aim';
      else if (onBody(key)) mode = spec.height ? 'height' : 'aim';
      if (!mode) return; // bukan pegangan → biarkan OrbitControls memutar kamera
      const geo = aimGeometry(app, key);
      const n = new THREE.Vector3();
      camera.getWorldDirection(n);
      if (mode === 'height') {
        n.y = 0; // bidang tegak menghadap kamera
        if (n.lengthSq() < 0.04) return; // tampilan atas: tinggi tidak bisa diseret
        n.normalize();
      }
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, tmp.set(...(mode === 'aim' ? geo.knob : geo.pivot)));
      e.stopImmediatePropagation(); // OrbitControls & deteksi ketuk tidak ikut
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      controls.enabled = false;
      canvas.style.cursor = 'grabbing';
      drag = { key, mode, id: e.pointerId, plane, ids: mode === 'aim' ? spec.ids : [spec.height.id], changed: false };
    },
    { capture: true },
  );

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) {
      // kursor (mouse): pegangan → "grab", komponen → "pointer"
      if (e.pointerType !== 'mouse' || e.buttons) return;
      const key = getCurrent();
      const r = toRay(e);
      const c = usable(key) && (knobDistancePx(key, e, r) < KNOB_PX || onBody(key)) ? 'grab' : pickHot(app, ray.ray) ? 'pointer' : '';
      if (canvas.style.cursor !== c) canvas.style.cursor = c;
      return;
    }
    if (e.pointerId !== drag.id) return;
    toRay(e);
    if (!ray.ray.intersectPlane(drag.plane, hit)) return;
    const spec = AIM[drag.key];
    let changed = false;
    if (drag.mode === 'aim') {
      const a = aimAngles(spec, spec.pivot(app), [hit.x, hit.y, hit.z]);
      if (!a) return;
      changed = setPanel(spec.ids[0], a.yaw);
      changed = setPanel(spec.ids[1], a.pitch) || changed;
      showLabel(`${a.yaw}° mendatar · ${a.pitch}° naik/turun`, e);
    } else {
      const h = spec.height;
      const y = Math.min(h.max, Math.max(h.min, Math.round(hit.y / h.step) * h.step));
      changed = setPanel(h.id, y);
      showLabel(`tinggi ${y} cm`, e);
    }
    if (changed) {
      drag.changed = true;
      onChange?.(drag.key);
    }
  });

  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    // "change" = akhir geser: log + simpan otomatis lewat panel
    if (drag.changed) for (const id of drag.ids) $(id)?.dispatchEvent(new Event('change', { bubbles: true }));
    canvas.releasePointerCapture?.(e.pointerId);
    drag = null;
    controls.enabled = true;
    canvas.style.cursor = '';
    label.hidden = true;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  return {
    /** Tiap frame: panah & bola pegangan untuk komponen terpilih. */
    frame() {
      const key = getCurrent();
      if (!usable(key)) return world.aim.set(null);
      const geo = aimGeometry(app, key);
      // cm per px layar di posisi bola (kamera perspektif) → ukuran pegangan tetap di layar
      const d = camera.position.distanceTo(tmp.set(...geo.knob));
      const cmPerPx = (2 * d * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, canvas.clientHeight);
      world.aim.set(geo, !!drag, cmPerPx);
    },
    get dragging() {
      return drag ? drag.mode : null;
    },
  };
}
