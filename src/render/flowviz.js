/**
 * Visualisasi CFD gaya "workbench": bidang potong berwarna (contour laju arus) +
 * garis arus beranimasi (particle trace) di atasnya.
 *
 * Teknik garis arus = "wind map" (mirip mapbox/webgl-wind) di GPU:
 *  1. posisi ribuan partikel disimpan di tekstur RGBA8 (16-bit per sumbu) dan dimajukan
 *     oleh shader memakai tekstur kecepatan bidang;
 *  2. partikel digambar sebagai titik ke tekstur jejak yang setiap frame dipudarkan
 *     (ping-pong), sehingga terbentuk garis-garis arus yang mengalir;
 *  3. mesh bidang menampilkan peta warna laju + tekstur jejak.
 * CPU hanya mengisi tekstur kecepatan kecil (±100×50) saat medan CFD baru tiba.
 */
import * as THREE from 'three';
import { colormapGLSL, colormap, COLORMAPS } from './colormaps.js';
import { DEAD_LO, DEAD_HI, DEAD_MAX } from './flowfog.js';
import { FILTER, filterOpaque } from '../layout.js';
import { QUANTITIES, displayValue, percentiles, RangeTracker, legendTicks } from './quantity.js';

const QUAD_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const RAND_GLSL = /* glsl */ `
const vec3 RC = vec3(12.9898, 78.233, 4375.85453);
float rand(const vec2 co) { float t = dot(RC.xy, co); return fract(sin(t) * (RC.z + t)); }`;

const DECODE_GLSL = /* glsl */ `
vec2 decodePos(vec4 c) { return vec2(c.r / 255.0 + c.b, c.g / 255.0 + c.a); }`;

const CMAP = colormapGLSL();

/** Flag di kanal alfa tekstur kecepatan. */
const FLUID = 1;
const OBSTACLE = 0.5;
const EMPTY = 0;

class FlowPlane {
  /**
   * @param {object} o
   * @param {string} o.name
   * @param {number[]} o.U vektor sumbu-u (cm), @param {number[]} o.V vektor sumbu-v (cm)
   * @param {number} o.texW @param {number} o.texH resolusi tekstur kecepatan
   * @param {number} o.pRes akar jumlah partikel
   * @param {number} o.trailW @param {number} o.trailH resolusi tekstur jejak
   * @param {(x:number,y:number,z:number,out:number[])=>void} o.sample isi out = [vu, vv, laju, lajuRata|NaN, flag]
   */
  constructor(o) {
    Object.assign(this, o);
    this.origin = new THREE.Vector3();
    this.sizeU = Math.hypot(...o.U);
    this.sizeV = Math.hypot(...o.V);
    this.n = o.pRes * o.pRes;
    this.active = this.n;

    /* tekstur kecepatan: rg = kecepatan sebidang (cm/s), b = laju untuk peta warna, a = flag */
    const N = o.texW * o.texH;
    this.velData = new Uint16Array(N * 4);
    this.velTex = new THREE.DataTexture(this.velData, o.texW, o.texH, THREE.RGBAFormat, THREE.HalfFloatType);
    this.velTex.magFilter = this.velTex.minFilter = THREE.LinearFilter;
    this.velTex.wrapS = this.velTex.wrapT = THREE.ClampToEdgeWrapping;
    this.velTex.needsUpdate = true;
    this.ema = new Float32Array(N); // rata-rata waktu di sisi klien (bila sampler tidak menyediakan)
    this.emaInit = false;
    this.scalars = new Float32Array(N);
    this.stats = null; // {p02, p95, p98} besaran yang ditampilkan
    this.speedP95 = 3; // untuk redup/terang partikel
    this.speeds = new Float32Array(N);

    /* partikel: tekstur posisi awal acak + dua render target ping-pong */
    const init = new Uint8Array(this.n * 4);
    for (let i = 0; i < init.length; i++) init[i] = Math.floor(Math.random() * 256);
    this.initTex = new THREE.DataTexture(init, o.pRes, o.pRes, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.initTex.needsUpdate = true;
    const rtOpts = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, type: THREE.UnsignedByteType };
    this.pA = new THREE.WebGLRenderTarget(o.pRes, o.pRes, rtOpts);
    this.pB = new THREE.WebGLRenderTarget(o.pRes, o.pRes, rtOpts);
    this.pRead = this.initTex;

    // mipmap mencegah kedip/noise saat bidang dilihat dari jauh (tekstur diperkecil)
    const trOpts = {
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
      type: THREE.UnsignedByteType,
    };
    this.tA = new THREE.WebGLRenderTarget(o.trailW, o.trailH, trOpts);
    this.tB = new THREE.WebGLRenderTarget(o.trailW, o.trailH, trOpts);
    this.needsClear = true;

    this.updateMat = new THREE.ShaderMaterial({
      uniforms: {
        uParticles: { value: null },
        uVel: { value: this.velTex },
        uScale: { value: new THREE.Vector2() },
        uSeed: { value: 0 },
        uDrop: { value: 0.003 },
        uDropBump: { value: 0.01 },
        uRef: { value: 10 },
      },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
uniform sampler2D uParticles; uniform sampler2D uVel; uniform vec2 uScale;
uniform float uSeed; uniform float uDrop; uniform float uDropBump; uniform float uRef;
varying vec2 vUv;
${RAND_GLSL}
${DECODE_GLSL}
void main() {
  vec2 pos = decodePos(texture2D(uParticles, vUv));
  vec4 v = texture2D(uVel, pos);
  vec2 dp = v.rg * uScale;
  float l = length(dp);
  if (l > 0.012) dp *= 0.012 / l;           // batasi lompatan per frame
  pos += dp;
  vec2 seed = (pos + vUv) * uSeed;
  float drop = uDrop + uDropBump * clamp(length(v.rg) / uRef, 0.0, 1.0);
  float d = step(1.0 - drop, rand(seed));
  vec4 vn = texture2D(uVel, clamp(pos, 0.0, 1.0));
  if (vn.a < 0.75 || pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0) d = 1.0;  // keluar fluida → lahir ulang
  pos = mix(pos, vec2(rand(seed + 1.3), rand(seed + 2.1)), d);
  gl_FragColor = vec4(fract(pos * 255.0), floor(pos * 255.0) / 255.0);
}`,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });

    this.fadeMat = new THREE.ShaderMaterial({
      uniforms: { uPrev: { value: null }, uFade: { value: 0.975 } },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
uniform sampler2D uPrev; uniform float uFade; varying vec2 vUv;
void main() { gl_FragColor = floor(255.0 * texture2D(uPrev, vUv) * uFade) / 255.0; }`,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });

    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.n * 3), 3));
    const idx = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) idx[i] = i;
    pg.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
    this.pointsGeo = pg;
    this.drawMat = new THREE.ShaderMaterial({
      uniforms: {
        uParticles: { value: null },
        uVel: { value: this.velTex },
        uRes: { value: o.pRes },
        uRef: { value: 10 },
        uCmap: { value: 0 },
        uSize: { value: 2.4 },
        uMin: { value: 0 },
        uMax: { value: 10 },
      },
      vertexShader: /* glsl */ `
attribute float aIdx;
uniform sampler2D uParticles; uniform sampler2D uVel; uniform float uRes; uniform float uRef; uniform int uCmap; uniform float uSize;
uniform float uMin; uniform float uMax;
varying vec4 vCol;
${DECODE_GLSL}
${CMAP}
void main() {
  vec2 puv = vec2(mod(aIdx, uRes) + 0.5, floor(aIdx / uRes) + 0.5) / uRes;
  vec2 pos = decodePos(texture2D(uParticles, puv));
  vec4 v = texture2D(uVel, pos);
  // warna = besaran yang ditampilkan; partikel di zona mati (hampir diam) dibuat redup
  float t = (v.b - uMin) / max(uMax - uMin, 1e-4);
  float a = smoothstep(0.02, 0.2, length(v.rg) / uRef);
  vCol = vec4(mix(cmap(t, uCmap), vec3(1.0), 0.22) * a, a);
  gl_PointSize = uSize;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`,
      fragmentShader: 'varying vec4 vCol; void main() { gl_FragColor = vCol; }',
      depthTest: false,
      depthWrite: false,
      // MAX: titik baru tidak pernah menggelapkan jejak yang sudah ada
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    this.points = new THREE.Points(pg, this.drawMat);
    this.points.frustumCulled = false;
    this.pointsScene = new THREE.Scene();
    this.pointsScene.add(this.points);

    /* mesh bidang di scene utama */
    const [Ux, Uy, Uz] = o.U;
    const [Vx, Vy, Vz] = o.V;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, Ux, Uy, Uz, Ux + Vx, Uy + Vy, Uz + Vz, Vx, Vy, Vz]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.displayMat = new THREE.ShaderMaterial({
      uniforms: {
        uVel: { value: this.velTex },
        uTrail: { value: this.tA.texture },
        uMin: { value: 0 },
        uMax: { value: 10 },
        uCmap: { value: 0 },
        uMapAlpha: { value: 0.85 },
        uBright: { value: 0.72 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
uniform sampler2D uVel; uniform sampler2D uTrail; uniform float uMin; uniform float uMax; uniform int uCmap; uniform float uMapAlpha; uniform float uBright;
varying vec2 vUv;
${CMAP}
void main() {
  vec4 v = texture2D(uVel, vUv);
  if (v.a < 0.2) discard;                                  // di atas permukaan air / di luar domain
  if (v.a < 0.75) { gl_FragColor = vec4(0.17, 0.17, 0.19, 0.5); return; }   // batu, pasir
  vec4 tr = texture2D(uTrail, vUv);                        // jejak (premultiplied)
  float ta = clamp(tr.a * 1.6, 0.0, 1.0);                  // pertegas garis arus
  vec3 base = cmap((v.b - uMin) / max(uMax - uMin, 1e-4), uCmap) * uBright;
  gl_FragColor = vec4(base * (1.0 - ta) + min(tr.rgb * 1.6, vec3(1.0)), max(uMapAlpha, ta));
}`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.displayMat);
    // digambar setelah kaca (8) supaya warna peta tidak pudar oleh lapisan kaca/air
    this.mesh.renderOrder = 9;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  setOrigin(x, y, z) {
    if (this.origin.x !== x || this.origin.y !== y || this.origin.z !== z) {
      this.origin.set(x, y, z);
      this.mesh.position.copy(this.origin);
      this.needsClear = true;
      this.emaInit = false;
      return true;
    }
    return false;
  }

  /** Isi tekstur kecepatan dari medan CFD; kanal b = besaran q (satuan legenda). */
  refresh(q, dtSim) {
    const { texW, texH, U, V, origin, velData, ema, scalars, speeds } = this;
    const out = [0, 0, 0, 0, 0, 0, 0, 35];
    const toHalf = THREE.DataUtils.toHalfFloat;
    const k = this.emaInit ? 1 - Math.exp(-Math.max(0, dtSim) / 8) : 1;
    let nf = 0;
    for (let j = 0; j < texH; j++) {
      const v = (j + 0.5) / texH;
      for (let i = 0; i < texW; i++) {
        const u = (i + 0.5) / texW;
        const x = origin.x + u * U[0] + v * V[0];
        const y = origin.y + u * U[1] + v * V[1];
        const z = origin.z + u * U[2] + v * V[2];
        this.sample(x, y, z, out);
        const c = j * texW + i;
        let s = 0;
        if (out[4] === FLUID) {
          ema[c] += (out[2] - ema[c]) * k;
          s = displayValue(q, out, ema[c]);
          speeds[nf] = out[2];
          scalars[nf++] = s;
        }
        const qd = c * 4;
        velData[qd] = toHalf(out[0]);
        velData[qd + 1] = toHalf(out[1]);
        velData[qd + 2] = toHalf(s);
        velData[qd + 3] = toHalf(out[4]);
      }
    }
    this.emaInit = true;
    this.velTex.needsUpdate = true;
    this.stats = percentiles(scalars, nf);
    const sp = percentiles(speeds, nf);
    if (sp) this.speedP95 = Math.max(1, sp.p95 * 1.15);
  }

  /** Jalankan pass GPU: majukan partikel, pudarkan jejak, gambar partikel. */
  runPasses(renderer, quad, cam, real, simdt, opts) {
    const autoClear = renderer.autoClear;
    if (this.needsClear) {
      for (const rt of [this.tA, this.tB]) {
        renderer.setRenderTarget(rt);
        renderer.clear(true, false, false);
      }
      this.needsClear = false;
    }
    const f60 = Math.min(3, real * 60); // normalisasi terhadap 60 fps
    // 1) partikel
    const u = this.updateMat.uniforms;
    u.uParticles.value = this.pRead;
    u.uScale.value.set((simdt * opts.speed) / this.sizeU, (simdt * opts.speed) / this.sizeV);
    u.uSeed.value = Math.random();
    u.uDrop.value = 0.003 * f60;
    u.uDropBump.value = 0.012 * f60;
    u.uRef.value = opts.ref;
    const pWrite = this.pRead === this.pA.texture ? this.pB : this.pA;
    quad.material = this.updateMat;
    renderer.setRenderTarget(pWrite);
    renderer.render(quad, cam);
    this.pRead = pWrite.texture;
    // 2) pudarkan jejak lama ke target baru
    const tRead = this.displayMat.uniforms.uTrail.value === this.tA.texture ? this.tA : this.tB;
    const tWrite = tRead === this.tA ? this.tB : this.tA;
    this.fadeMat.uniforms.uPrev.value = tRead.texture;
    this.fadeMat.uniforms.uFade.value = Math.pow(opts.fade, f60);
    quad.material = this.fadeMat;
    renderer.setRenderTarget(tWrite);
    renderer.render(quad, cam);
    // 3) gambar partikel di atasnya (tanpa clear)
    const d = this.drawMat.uniforms;
    d.uParticles.value = this.pRead;
    d.uRef.value = opts.ref;
    d.uCmap.value = opts.cmap;
    d.uMin.value = opts.min;
    d.uMax.value = opts.max;
    this.pointsGeo.setDrawRange(0, this.active);
    renderer.autoClear = false;
    renderer.setRenderTarget(tWrite);
    renderer.render(this.pointsScene, cam);
    renderer.autoClear = autoClear;
    this.displayMat.uniforms.uTrail.value = tWrite.texture;
  }
}

/** Legenda skala warna di pojok tampilan 3D. */
function createLegend(container) {
  const box = document.createElement('div');
  box.id = 'fvLegend';
  box.hidden = true;
  box.innerHTML = '<div class="t"></div><canvas width="200" height="12"></canvas><div class="ticks"></div>';
  container.append(box);
  const title = box.querySelector('.t');
  const cv = box.querySelector('canvas');
  const ticks = box.querySelector('.ticks');
  let key = '';
  /** @param {string} q besaran; deadOnly: legenda khusus kabut zona mati */
  return (visible, cmapName, min, max, q, deadOnly = false) => {
    box.hidden = !visible;
    if (!visible) return;
    const qq = QUANTITIES[q] || QUANTITIES.inst;
    const tk = deadOnly ? [0, 0.5, 1].map((v) => ({ v, text: String(v).replace('.', ',') })) : legendTicks(q, min, max);
    const lo = deadOnly ? 0 : min;
    const hi = deadOnly ? DEAD_MAX : max;
    const k = `${cmapName}|${q}|${deadOnly}|${tk.map((t) => t.text).join()}`;
    if (k === key) return;
    key = k;
    title.textContent = deadOnly ? 'Kabut zona mati: laju rata-rata < 1 cm/s' : `${qq.label} (${qq.unit})`;
    const x = cv.getContext('2d');
    if (x) {
      const c = [0, 0, 0];
      for (let i = 0; i < cv.width; i++) {
        const t = i / (cv.width - 1);
        if (deadOnly) for (let j = 0; j < 3; j++) c[j] = DEAD_LO[j] + (DEAD_HI[j] - DEAD_LO[j]) * t;
        else colormap(cmapName, t, c);
        x.fillStyle = `rgb(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0})`;
        x.fillRect(i, 0, 1, cv.height);
      }
    }
    ticks.innerHTML = tk
      .map((t) => `<span style="left:${(((t.v - lo) / Math.max(1e-9, hi - lo)) * 100).toFixed(1)}%">${t.text}</span>`)
      .join('');
  };
}

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {object} app state aplikasi
 * @param {import('../cfd/client.js').FlowClient} flow
 * @param {HTMLElement} container elemen tampilan 3D (untuk legenda)
 */
export function createFlowViz(renderer, scene, app, flow, container) {
  const v3 = [0, 0, 0];
  // tank: bidang mendatar pada ketinggian y
  const tankH = new FlowPlane({
    name: 'tankH',
    U: [49, 0, 0],
    V: [0, 0, 24],
    texW: 98,
    texH: 48,
    pRes: 80,
    trailW: 1024,
    trailH: 512,
    sample(x, y, z, o) {
      o[0] = o[1] = o[2] = 0;
      o[3] = NaN;
      if (y > app.S.HT - 0.25) return void (o[4] = EMPTY);
      if (flow.cellOf(x, y, z) < 0) return void (o[4] = OBSTACLE);
      flow.sample3(x, y, z, v3);
      o[0] = v3[0];
      o[1] = v3[2];
      o[2] = Math.hypot(v3[0], v3[1], v3[2]);
      o[3] = flow.sampleAvg3(x, y, z);
      o[4] = FLUID;
      o[5] = flow.scalarT('age', x, y, z);
      o[6] = flow.scalarT('dye', x, y, z);
      o[7] = flow.scalarT('salt', x, y, z);
    },
  });
  // tank: bidang tegak memanjang pada kedalaman z
  const tankV = new FlowPlane({
    name: 'tankV',
    U: [49, 0, 0],
    V: [0, 30, 0],
    texW: 98,
    texH: 60,
    pRes: 80,
    trailW: 1024,
    trailH: 640,
    sample(x, y, z, o) {
      o[0] = o[1] = o[2] = 0;
      o[3] = NaN;
      if (y > app.S.HT - 0.25) return void (o[4] = EMPTY);
      if (flow.cellOf(x, y, z) < 0) return void (o[4] = OBSTACLE);
      flow.sample3(x, y, z, v3);
      o[0] = v3[0];
      o[1] = v3[1];
      o[2] = Math.hypot(v3[0], v3[1], v3[2]);
      o[3] = flow.sampleAvg3(x, y, z);
      o[4] = FLUID;
      o[5] = flow.scalarT('age', x, y, z);
      o[6] = flow.scalarT('dye', x, y, z);
      o[7] = flow.scalarT('salt', x, y, z);
    },
  });
  // filter: penampang memanjang pada kedalaman z (medan 3D)
  const filter = new FlowPlane({
    name: 'filter',
    U: [49, 0, 0],
    V: [0, 30, 0],
    texW: 98,
    texH: 60,
    pRes: 72,
    trailW: 1024,
    trailH: 640,
    sample(x, y, z, o) {
      o[0] = o[1] = o[2] = 0;
      if (flow.cellF(x, y, z) < 0) return void (o[4] = filterOpaque(x, y, z) ? OBSTACLE : EMPTY);
      flow.sampleF(x, y, z, v3);
      o[0] = v3[0];
      o[1] = v3[1];
      o[2] = Math.hypot(v3[0], v3[1], v3[2]);
      o[3] = flow.sampleAvgF(x, y, z);
      o[4] = FLUID;
      o[5] = flow.scalarF('age', x, y, z);
      o[6] = flow.scalarF('dye', x, y, z);
      o[7] = flow.scalarF('salt', x, y, z);
    },
  });
  const planes = [tankH, tankV, filter];
  for (const p of planes) scene.add(p.mesh);

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const legend = createLegend(container);

  let lastVersion = -1;
  let lastRefresh = 0;
  let simSinceRefresh = 0;
  let lastKey = '';
  let lastReal = 0;
  let lastSim = 0;
  const range = new RangeTracker();

  /**
   * @param {{on: boolean, stats: object, mode: string}} [fog] kabut 3D (ikut skala warna & legenda yang sama)
   */
  function update(real, simdt, fog = { on: false, stats: null, mode: 'fast' }) {
    const { V, FV, S } = app;
    lastReal = real;
    lastSim = simdt;
    simSinceRefresh += simdt;
    const on = V.cfd;
    tankH.mesh.visible = on && V.planeOn && FV.orient === 'h';
    tankV.mesh.visible = on && V.planeOn && FV.orient === 'v';
    filter.mesh.visible = on && V.filterPlane;
    const moved =
      tankH.setOrigin(0.5, Math.min(app.sliceY, 29), 0.5) |
      tankV.setOrigin(0.5, 0, Math.max(0.8, Math.min(24.2, FV.sliceZ))) |
      filter.setOrigin(0.5, 0, FILTER.z0 + Math.max(0.3, Math.min(9.7, FV.filterZ)));
    const visible = planes.filter((p) => p.mesh.visible);
    const q = FV.value;
    const key = `${q}|${visible.map((p) => p.name).join()}|${[S.HT, S.H1, S.H2, S.H3, S.HP].map((x) => Math.round(x * 4)).join()}`;
    const now = performance.now();
    const changed = key !== lastKey;
    if (visible.length && (moved || changed || (flow.version !== lastVersion && now - lastRefresh > 90))) {
      for (const p of visible) p.refresh(q, simSinceRefresh);
      lastVersion = flow.version;
      lastRefresh = now;
      lastKey = key;
      simSinceRefresh = 0;
    }
    // rentang skala warna: otomatis dari persentil semua tampilan aktif (dihaluskan) atau manual
    const stats = visible.map((p) => p.stats);
    if (fog.on) stats.push(fog.stats);
    range.update(q, stats, FV.vmax, real, !!moved);
    const ci = Math.max(0, COLORMAPS.indexOf(FV.cmap));
    for (const p of visible) {
      const u = p.displayMat.uniforms;
      u.uMin.value = range.min;
      u.uMax.value = range.max;
      u.uCmap.value = ci;
      u.uMapAlpha.value = FV.mapAlpha;
    }
    // legenda khusus bila yang tampil hanya kabut zona mati
    legend(visible.length > 0 || fog.on, FV.cmap, range.min, range.max, q, fog.on && fog.mode === 'dead' && visible.length === 0);
  }

  /** Dipanggil SETELAH render utama: pass GPU untuk frame berikutnya. */
  function runPasses() {
    if (app.paused || lastSim <= 0) return;
    const vis = planes.filter((p) => p.mesh.visible);
    if (!vis.length) return;
    const FV = app.FV;
    const isSpeed = QUANTITIES[FV.value]?.speed;
    const prev = renderer.getRenderTarget();
    for (const p of vis) {
      const opts = {
        speed: FV.anim,
        fade: 0.985,
        ref: isSpeed ? range.max : p.speedP95, // acuan laju untuk terang/redup partikel
        cmap: Math.max(0, COLORMAPS.indexOf(FV.cmap)),
        min: range.min,
        max: range.max,
      };
      p.runPasses(renderer, quad, cam, lastReal, lastSim, opts);
    }
    renderer.setRenderTarget(prev);
  }

  function setQuality(level) {
    // perangkat lemah: seperempat partikel
    for (const p of planes) p.active = level >= 3 ? Math.floor(p.n / 4) : p.n;
  }

  /** Diagnostik: majukan animasi garis arus n langkah sekaligus (uji otomatis di perangkat lambat). */
  function debugAdvance(n = 60, simdt = 0.05) {
    const save = [lastReal, lastSim];
    lastReal = 1 / 60;
    lastSim = simdt;
    for (let i = 0; i < n; i++) runPasses();
    [lastReal, lastSim] = save;
  }

  return {
    update,
    runPasses,
    setQuality,
    planes,
    debugAdvance,
    /** rentang skala warna yang sedang dipakai (satuan besaran) */
    get range() {
      return range;
    },
  };
}
