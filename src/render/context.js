/**
 * Renderer, scene, kamera, kontrol orbit, lingkungan pantulan dan lampu.
 *
 * Sejak three r155 lampu memakai satuan fisik. Intensitas versi 1 (mode legacy)
 * dikalikan π supaya terangnya setara; SpotLight LED memakai decay 0 karena
 * satuan scene adalah cm (falloff 1/d² dalam cm akan membuatnya nyaris gelap).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const LIGHT = Object.freeze({
  hemi: 0.32 * Math.PI,
  sun: 0.85 * Math.PI,
  // 1,6 × π × faktor falloff legacy rata-rata pada jarak lampu–dasar (±0,55)
  led: 1.6 * Math.PI * 0.55,
});

const VIEWS = {
  iso: [
    [84, 44, 72],
    [25, 12, 3],
  ],
  front: [
    [25, 24, 100],
    [25, 13, 4],
  ],
  back: [
    [25, 40, -88],
    [25, 14, -6],
  ],
  top: [
    [25, 130, 6.6],
    [25, 0, 6],
  ],
};

export function createContext(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // bayangan statis: hanya dihitung ulang bila ada yang berubah (lihat markShadowsDirty)
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  container.insertBefore(renderer.domElement, container.firstChild);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 2, 1400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.54;
  controls.minDistance = 22;
  controls.maxDistance = 260;

  /* lingkungan pantulan: ruangan sederhana dengan jendela & lampu plafon terang */
  const es = new THREE.Scene();
  es.add(new THREE.Mesh(new THREE.BoxGeometry(220, 130, 220), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.58, 0.6), side: THREE.BackSide })));
  const pan = (w, h, x, y, z, rx, ry, col) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    es.add(m);
  };
  pan(110, 70, 0, 63, 10, Math.PI / 2, 0, new THREE.Color(5, 5, 5));
  pan(80, 60, -108, 12, 0, 0, Math.PI / 2, new THREE.Color(3, 3.3, 3.8));
  pan(60, 40, 40, 20, 108, 0, 0, new THREE.Color(1.6, 1.5, 1.3));
  pan(220, 220, 0, -64, 0, Math.PI / 2, 0, new THREE.Color(0.25, 0.19, 0.14));
  const pm = new THREE.PMREMGenerator(renderer);
  const envTex = pm.fromScene(es, 0.03).texture;
  pm.dispose();
  es.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  scene.environment = envTex;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a7f72, LIGHT.hemi);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e2, LIGHT.sun);
  sun.position.set(75, 115, 100);
  sun.target.position.set(25, 0, 5);
  scene.add(sun, sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 95, bottom: -95, near: 10, far: 340 });
  sun.shadow.bias = -0.0015;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 3;

  const led = new THREE.SpotLight(0xb4d4ff, LIGHT.led, 95, 0.95, 0.7, 0);
  led.position.set(25, 43, 12.5);
  led.target.position.set(25, 0, 12.5);
  scene.add(led, led.target);

  function setView(k) {
    const v = VIEWS[k];
    const s = Math.min(1.9, Math.max(1, 1.6 / (camera.aspect || 1.6)));
    camera.position.set(v[1][0] + (v[0][0] - v[1][0]) * s, v[1][1] + (v[0][1] - v[1][1]) * s, v[1][2] + (v[0][2] - v[1][2]) * s);
    controls.target.set(v[1][0], v[1][1], v[1][2]);
    controls.update();
  }

  function resize() {
    const w = container.clientWidth || 320;
    const h = container.clientHeight || 260;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const markShadowsDirty = () => {
    renderer.shadowMap.needsUpdate = true;
  };

  return { renderer, scene, camera, controls, envTex, hemi, sun, led, setView, resize, markShadowsDirty };
}
