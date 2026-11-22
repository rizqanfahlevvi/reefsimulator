/**
 * Gaya 3D realistis (dipilih dari mockup):
 *  - Detail permukaan: batu hidup berpori (bump + lubang) dengan warna krem hangat yang
 *    mengalikan warna koralin per titik; pasir berbutir; riak halus berkilau di permukaan air.
 *  - Air makin biru ke dasar (warna per titik di kotak air) dan sedikit lebih jernih.
 *  - Berkas cahaya (god rays) dari lampu LED ke dalam air: bidang aditif yang menghadap kamera,
 *    warnanya mengikuti lampu dan berdenyut pelan.
 *  - Ambient occlusion (GTAO three.js) di resolusi setengah, DITUMPANGKAN (multiply) di atas
 *    render biasa — bukan lewat EffectComposer: komposer mencampur air & kaca transparan di
 *    ruang warna linear sehingga keduanya tampak pucat. Benda penanda (label, partikel, bidang
 *    arus, kabut, sorotan, panah) digambar SESUDAH AO supaya tidak ikut tergelapkan.
 *
 * Semua tekstur dibuat prosedural (tanpa unduhan). Beban GPU bertingkat: lihat world.setQuality.
 */
import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { createRng } from '../util/random.js';

/**
 * Medan noise fbm yang bisa diulang tanpa sambungan (tileable), dengan opsi lubang pori.
 * Murni (tanpa DOM) supaya bisa diuji.
 * @returns {Float32Array} nilai 0..1, size×size baris demi baris
 */
export function noiseField(size, { octaves = 5, base = 4, pits = 0, seed = 1, contrast = 1 } = {}) {
  const r = createRng(seed);
  for (let i = 0; i < 8; i++) r(); // Park–Miller: beberapa nilai pertama terlalu kecil untuk seed kecil
  const grids = [];
  for (let o = 0; o < octaves; o++) {
    const n = base << o;
    grids.push({ n, g: Float32Array.from({ length: n * n }, () => r()) });
  }
  const s = (t) => t * t * (3 - 2 * t);
  const val = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 1;
      for (const { n, g } of grids) {
        const fx = (x / size) * n;
        const fy = (y / size) * n;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const x1 = (x0 + 1) % n;
        const y1 = (y0 + 1) % n;
        const tx = s(fx - x0);
        const ty = s(fy - y0);
        const a = g[y0 * n + x0] + (g[y0 * n + x1] - g[y0 * n + x0]) * tx;
        const b = g[y1 * n + x0] + (g[y1 * n + x1] - g[y1 * n + x0]) * tx;
        v += (a + (b - a) * ty) * amp;
        amp *= 0.5;
      }
      val[y * size + x] = v;
    }
  // lubang pori: dicap hanya di sekitar tiap lubang (dengan bungkus tepi supaya tetap tileable)
  for (let k = 0; k < pits; k++) {
    const px = r() * size;
    const py = r() * size;
    const pr = (0.012 + r() * 0.03) * size;
    const R = Math.ceil(pr);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dy) / pr;
        if (d >= 1) continue;
        const x = (((Math.floor(px) + dx) % size) + size) % size;
        const y = (((Math.floor(py) + dy) % size) + size) % size;
        val[y * size + x] -= 0.9 * (1 - d * d);
      }
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of val) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  for (let i = 0; i < val.length; i++) val[i] = Math.min(1, Math.max(0, 0.5 + ((val[i] - lo) / span - 0.5) * contrast));
  return val;
}

/** Tekstur abu-abu (data) dari noiseField, berulang di kedua arah. */
export function noiseTexture(size, opts) {
  const v = noiseField(size, opts);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < v.length; i++) {
    const c = Math.round(v[i] * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = c;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Warna kotak air: dasar lebih biru-gelap, permukaan lebih terang (dikalikan warna material). */
export function waterGradient(t) {
  return [0.3 + 0.7 * t, 0.52 + 0.48 * t, 0.8 + 0.2 * t];
}

/**
 * Detail permukaan batu, pasir, air. Mengembalikan tick(t) untuk riak yang bergerak.
 * @param {object} M material scene
 * @param {THREE.Scene} scene
 * @param {THREE.Material} surfMat material permukaan air tank
 */
export function applySurfaceDetail(M, scene, surfMat) {
  const grain = noiseTexture(256, { octaves: 5, base: 16, seed: 3, contrast: 1.4 });
  grain.repeat.set(9, 5);
  M.sand.bumpMap = grain;
  M.sand.bumpScale = 4;
  M.sand.color.setRGB(1.18, 1.14, 1.04);
  M.sand.needsUpdate = true;

  const pores = noiseTexture(512, { octaves: 6, base: 6, pits: 220, seed: 11, contrast: 1.2 });
  pores.repeat.set(3, 2);
  M.rock.bumpMap = pores;
  M.rock.bumpScale = 7;
  M.rock.roughness = 0.9;
  M.rock.color.set(0xffcfa8); // krem hangat × warna koralin per titik
  M.rock.needsUpdate = true;

  // air tank: makin dalam makin biru (warna per titik). Semua mesh yang memakai M.water harus
  // punya atribut warna, kalau tidak warnanya hitam.
  M.water.vertexColors = true;
  M.water.opacity = 0.3;
  M.water.needsUpdate = true;
  scene.traverse((o) => {
    if (!o.isMesh || ![].concat(o.material).includes(M.water)) return;
    const p = o.geometry.attributes.position;
    const box = o.geometry.boundingBox || (o.geometry.computeBoundingBox(), o.geometry.boundingBox);
    const h = box.max.y - box.min.y || 1;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) col.set(waterGradient((p.getY(i) - box.min.y) / h), i * 3);
    o.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  });

  const ripple = noiseTexture(256, { octaves: 4, base: 4, seed: 5, contrast: 1.1 });
  ripple.repeat.set(4, 2);
  if (surfMat) {
    surfMat.bumpMap = ripple;
    surfMat.bumpScale = 3;
    surfMat.envMapIntensity = Math.max(surfMat.envMapIntensity, 1.6);
    surfMat.needsUpdate = true;
  }
  M.glass.envMapIntensity = 2.0;
  return (t) => ripple.offset.set(t * 0.012, t * 0.007);
}

const RAY_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const RAY_FRAG = /* glsl */ `
uniform float uT; uniform float uSeed; uniform float uA; uniform vec3 uC; varying vec2 vUv;
void main(){
  float e = smoothstep(0.0, 0.45, vUv.x) * smoothstep(1.0, 0.55, vUv.x);
  float f = pow(vUv.y, 1.4);
  float k = 0.6 + 0.4 * sin(uT * 0.7 + uSeed * 6.2832);
  gl_FragColor = vec4(uC * e * f * k * uA, 1.0);
}`;

/**
 * Berkas cahaya dari lampu LED ke dalam air tank.
 * @returns {{group: THREE.Group, update: (HT: number, strength: number, color: number[], camera: THREE.Camera) => void, dispose: () => void}}
 */
export function createGodRays(scene, uT) {
  const r = createRng(7);
  for (let i = 0; i < 8; i++) r();
  const group = new THREE.Group();
  group.name = 'godRays';
  const color = new THREE.Color(0.78, 0.92, 1);
  const mats = [];
  for (let i = 0; i < 9; i++) {
    const w = 2.5 + r() * 4;
    const geo = new THREE.PlaneGeometry(w, 1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT, uSeed: { value: r() }, uA: { value: 0 }, uC: { value: color } },
      vertexShader: RAY_VERT,
      fragmentShader: RAY_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    mat.userData.a0 = 0.09 + r() * 0.08;
    mats.push(mat);
    const m = new THREE.Mesh(geo, mat);
    m.userData.p = [7 + r() * 36, 4 + r() * 17];
    m.userData.tilt = (r() - 0.5) * 0.35;
    m.renderOrder = 4;
    m.frustumCulled = false;
    group.add(m);
  }
  scene.add(group);
  return {
    group,
    update(HT, strength, rgb, camera) {
      group.visible = strength > 0.01 && HT > 2;
      if (!group.visible) return;
      color.setRGB(0.55 + 0.45 * rgb[0], 0.6 + 0.4 * rgb[1], 0.7 + 0.3 * rgb[2]);
      for (const m of group.children) {
        m.material.uniforms.uA.value = m.material.userData.a0 * strength;
        m.position.set(m.userData.p[0], 0.2, m.userData.p[1]);
        m.scale.set(1, Math.max(1, HT - 0.4), 1);
        m.rotation.set(0, Math.atan2(camera.position.x - m.position.x, camera.position.z - m.position.z), m.userData.tilt, 'YXZ');
      }
    },
    dispose() {
      for (const m of group.children) {
        m.geometry.dispose();
        m.material.dispose();
      }
      scene.remove(group);
    },
  };
}

const isTransparent = (m) => (Array.isArray(m) ? m.some((x) => x.transparent) : m?.transparent);

/**
 * Ambient occlusion ditumpangkan (multiply). Dibuat saat pertama dipakai; dibuang saat dimatikan.
 * @returns {{enabled: boolean, setEnabled: (on: boolean) => void, resize: () => void, invalidate: () => void, apply: () => void}}
 */
export function createAO(renderer, scene, camera, { intensity = 0.9, radius = 2.6, thickness = 2.5, scale = 0.5 } = {}) {
  let st = null;
  let enabled = false;
  const size = () => {
    const v = renderer.getDrawingBufferSize(new THREE.Vector2());
    return [Math.max(64, Math.round(v.x * scale)), Math.max(64, Math.round(v.y * scale))];
  };
  function build() {
    const [w, h] = size();
    const gtao = new GTAOPass(scene, camera, w, h);
    gtao.output = GTAOPass.OUTPUT.Denoise;
    gtao.renderToScreen = false;
    gtao.updateGtaoMaterial({ radius, distanceExponent: 1.4, thickness, scale: 1.1, samples: 16 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    // kaca, air, sprite label tidak ikut menghitung AO → batu & karang di balik kaca tetap kena
    const orig = gtao._overrideVisibility.bind(gtao);
    gtao._overrideVisibility = function () {
      orig();
      scene.traverse((o) => {
        if ((o.isMesh || o.isSprite) && o.visible && isTransparent(o.material)) {
          o.visible = false;
          this._visibilityCache.push(o);
        }
      });
    };
    const wb = new THREE.WebGLRenderTarget(w, h);
    const rb = new THREE.WebGLRenderTarget(w, h);
    const mat = new THREE.ShaderMaterial({
      uniforms: { tAO: { value: null }, uI: { value: intensity } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader:
        'uniform sampler2D tAO; uniform float uI; varying vec2 vUv; void main(){ float ao = texture2D(tAO, vUv).r; gl_FragColor = vec4(vec3(mix(1.0, ao, uI)), 1.0); }',
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    const qs = new THREE.Scene();
    qs.add(quad);
    st = { gtao, wb, rb, mat, quad, qs, qc: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), w, h };
  }
  function dispose() {
    if (!st) return;
    st.gtao.dispose();
    st.wb.dispose();
    st.rb.dispose();
    st.mat.dispose();
    st.quad.geometry.dispose();
    st = null;
  }
  return {
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = !!on;
      if (!enabled) dispose();
    },
    resize() {
      if (!st) return;
      const [w, h] = size();
      if (w === st.w && h === st.h) return;
      st.gtao.setSize(w, h);
      st.wb.setSize(w, h);
      st.rb.setSize(w, h);
      st.w = w;
      st.h = h;
    },
    /** Render target hilang bersama context WebGL: buat ulang saat dipakai berikutnya. */
    invalidate: dispose,
    /** Hitung AO dari scene saat ini lalu kalikan ke layar (render utama sudah ada di layar). */
    apply() {
      if (!enabled) return;
      if (!st) build();
      st.gtao.render(renderer, st.wb, st.rb);
      st.mat.uniforms.tAO.value = st.gtao.pdRenderTarget.texture;
      renderer.setRenderTarget(null);
      const ac = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(st.qs, st.qc);
      renderer.autoClear = ac;
    },
  };
}
