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
    this.p95 = 2;

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
      },
      vertexShader: /* glsl */ `
attribute float aIdx;
uniform sampler2D uParticles; uniform sampler2D uVel; uniform float uRes; uniform float uRef; uniform int uCmap; uniform float uSize;
varying vec4 vCol;
${DECODE_GLSL}
${CMAP}
void main() {
  vec2 puv = vec2(mod(aIdx, uRes) + 0.5, floor(aIdx / uRes) + 0.5) / uRes;
  vec2 pos = decodePos(texture2D(uParticles, puv));
  vec4 v = texture2D(uVel, pos);
  float t = length(v.rg) / uRef;
  // partikel di zona mati (hampir diam) dibuat redup supaya tidak jadi bintik statis
  float a = smoothstep(0.02, 0.2, t);
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
        uMax: { value: 10 },
        uCmap: { value: 0 },
        uMapAlpha: { value: 0.85 },
        uBright: { value: 0.72 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
uniform sampler2D uVel; uniform sampler2D uTrail; uniform float uMax; uniform int uCmap; uniform float uMapAlpha; uniform float uBright;
varying vec2 vUv;
${CMAP}
void main() {
  vec4 v = texture2D(uVel, vUv);
  if (v.a < 0.2) discard;                                  // di atas permukaan air / di luar domain
  if (v.a < 0.75) { gl_FragColor = vec4(0.17, 0.17, 0.19, 0.5); return; }   // batu, pasir
  vec4 tr = texture2D(uTrail, vUv);                        // jejak (premultiplied)
  float ta = clamp(tr.a * 1.6, 0.0, 1.0);                  // pertegas garis arus
  vec3 base = cmap(v.b / uMax, uCmap) * uBright;
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

  /** Isi tekstur kecepatan dari medan CFD. `useAvg`: peta warna memakai rata-rata waktu. */
  refresh(useAvg, dtSim) {
    const { texW, texH, U, V, origin, velData, ema, scalars } = this;
    const out = [0, 0, 0, 0, 0];
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
        let s = out[2];
        if (out[4] === FLUID) {
          ema[c] += (s - ema[c]) * k;
          if (useAvg) s = Number.isNaN(out[3]) ? ema[c] : out[3];
          scalars[nf++] = s;
        }
        const q = c * 4;
        velData[q] = toHalf(out[0]);
        velData[q + 1] = toHalf(out[1]);
        velData[q + 2] = toHalf(s);
        velData[q + 3] = toHalf(out[4]);
      }
    }
    this.emaInit = true;
    this.velTex.needsUpdate = true;
    // persentil 95 untuk skala warna otomatis
    if (nf > 10) {
      const arr = scalars.subarray(0, nf).slice().sort();
      this.p95 = arr[Math.floor(nf * 0.95)];
    }
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
  return (visible, cmapName, max, avg, deadOnly = false) => {
    box.hidden = !visible;
    if (!visible) return;
    const m = deadOnly ? DEAD_MAX : Math.max(1, Math.round(max * 2) / 2);
    const k = `${cmapName}|${m}|${avg}|${deadOnly}`;
    if (k === key) return;
    key = k;
    title.textContent = deadOnly
      ? `Kabut zona mati: laju ${avg ? 'rata-rata 8 dtk ' : ''}< 1 cm/s`
      : avg
        ? 'Laju arus rata-rata 8 dtk (cm/s)'
        : 'Laju arus (cm/s)';
    const x = cv.getContext('2d');
    if (x) {
      const c = [0, 0, 0];
      for (let i = 0; i < cv.width; i++) {
        const t = i / (cv.width - 1);
        if (deadOnly) for (let q = 0; q < 3; q++) c[q] = DEAD_LO[q] + (DEAD_HI[q] - DEAD_LO[q]) * t;
        else colormap(cmapName, t, c);
        x.fillStyle = `rgb(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0})`;
        x.fillRect(i, 0, 1, cv.height);
      }
    }
    // tanda nilai: 0, batas kategori reef (1 mati, 3 lemah, 8 kuat) yang muat, dan maksimum
    const vals = deadOnly ? [0, 0.5, 1] : [0, 1, 3, 8].filter((v) => v < m * 0.92);
    if (!deadOnly) vals.push(m);
    ticks.innerHTML = vals
      .map((v) => `<span style="left:${(v / m) * 100}%">${String(v).replace('.', ',')}${v === m && !deadOnly ? '+' : ''}</span>`)
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
    },
  });
  // filter: penampang memanjang di tengah chamber (medan 2D)
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
      o[3] = NaN;
      if (flow.cell2(x, y) < 0) return void (o[4] = EMPTY);
      flow.sample2(x, y, v3);
      o[0] = v3[0];
      o[1] = v3[1];
      o[2] = Math.hypot(v3[0], v3[1]);
      o[4] = FLUID;
    },
  });
  filter.setOrigin(0.5, 0, -7.5);
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
  let maxS = 6;
  let lastReal = 0;
  let lastSim = 0;
  let currentMax = 6;

  /**
   * @param {{on: boolean, p95: number}} [fog] kabut kecepatan 3D (ikut skala warna & legenda yang sama)
   */
  function update(real, simdt, fog = { on: false, p95: 0, mode: 'fast' }) {
    const { V, FV, S } = app;
    lastReal = real;
    lastSim = simdt;
    simSinceRefresh += simdt;
    const on = V.cfd;
    tankH.mesh.visible = on && V.planeOn && FV.orient === 'h';
    tankV.mesh.visible = on && V.planeOn && FV.orient === 'v';
    filter.mesh.visible = on && V.filterPlane;
    const moved = tankH.setOrigin(0.5, Math.min(app.sliceY, 29), 0.5) | tankV.setOrigin(0.5, 0, Math.max(0.8, Math.min(24.2, FV.sliceZ)));
    const visible = planes.filter((p) => p.mesh.visible);
    const useAvg = FV.value === 'avg';
    const key = `${FV.value}|${visible.map((p) => p.name).join()}|${Math.round(S.HT * 4)}`;
    const now = performance.now();
    if (visible.length && (moved || key !== lastKey || (flow.version !== lastVersion && now - lastRefresh > 90))) {
      for (const p of visible) p.refresh(useAvg, simSinceRefresh);
      lastVersion = flow.version;
      lastRefresh = now;
      lastKey = key;
      simSinceRefresh = 0;
    }
    // skala warna otomatis: persentil 95 dari semua tampilan aktif, dihaluskan terhadap waktu
    const srcs = visible.map((p) => p.p95);
    if (fog.on) srcs.push(fog.p95);
    if (srcs.length) {
      const target = Math.max(2, Math.max(...srcs) * 1.15);
      maxS += (target - maxS) * (moved ? 1 : Math.min(1, real * 2.5));
    }
    const vmax = FV.vmax > 0 ? FV.vmax : maxS;
    const ci = Math.max(0, COLORMAPS.indexOf(FV.cmap));
    for (const p of visible) {
      const u = p.displayMat.uniforms;
      u.uMax.value = vmax;
      u.uCmap.value = ci;
      u.uMapAlpha.value = FV.mapAlpha;
    }
    // legenda khusus bila yang tampil hanya kabut zona mati
    legend(visible.length > 0 || fog.on, FV.cmap, vmax, useAvg, fog.on && fog.mode === 'dead' && visible.length === 0);
    currentMax = vmax;
  }

  /** Dipanggil SETELAH render utama: pass GPU untuk frame berikutnya. */
  function runPasses() {
    if (app.paused || lastSim <= 0) return;
    const vis = planes.filter((p) => p.mesh.visible);
    if (!vis.length) return;
    const FV = app.FV;
    const vmax = FV.vmax > 0 ? FV.vmax : maxS;
    const opts = { speed: FV.anim, fade: 0.985, ref: vmax, cmap: Math.max(0, COLORMAPS.indexOf(FV.cmap)) };
    const prev = renderer.getRenderTarget();
    for (const p of vis) p.runPasses(renderer, quad, cam, lastReal, lastSim, opts);
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
    /** batas atas skala warna yang sedang dipakai (cm/s) */
    get vmax() {
      return currentMax;
    },
  };
}
