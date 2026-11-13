/**
 * Titik masuk aplikasi: rakit simulasi hidrolik, mesin arus (worker), dunia 3D, dan UI.
 */
import './styles.css';
import { app, on } from './state.js';
import { advance } from './sim.js';
import { FlowClient } from './cfd/client.js';
import { buildControls } from './ui/controls.js';
import { buildMetrics } from './ui/metrics.js';
import { buildElectricity } from './ui/electricity.js';
import { drawCharts } from './ui/charts.js';
import { $ } from './util/format.js';

const view = $('view');
let world = null;

const flow = new FlowClient(app);

/* dunia 3D (dimuat terpisah supaya UI dan angka tetap jalan bila WebGL gagal) */
async function initWorld() {
  try {
    const { createWorld } = await import('./render/world.js');
    world = createWorld(view, app, flow);
  } catch (err) {
    console.error('Gagal membuat tampilan 3D', err);
    $('glError').hidden = false;
    $('vbtn').hidden = true;
    $('hint').hidden = true;
    world = null;
  }
}

await initWorld();
flow.start();

let autoQuality = true;
const hooks = {
  rebuildSiphon: () => world?.rebuildSiphon(),
  applyView: () => world?.applyView(),
  applyGlass: () => world?.applyGlass(),
  applyBg: () => world?.applyBg(),
  setQuality: (l) => world?.setQuality(l),
  setAutoQuality: (v) => (autoQuality = v),
  resetFlow: () => (flow.resetNext = true),
  updElec: () => elec.update(),
};
const elec = buildElectricity();
const metrics = buildMetrics();
const ui = buildControls(hooks);

// perubahan slider siphon dibangun ulang dengan jeda (debounce) ±90 ms
let siphonDirty = false;
let siphonAt = 0;
on('siphon-dirty', () => (siphonDirty = true));

document.querySelectorAll('#vbtn button[data-v]').forEach((b) => b.addEventListener('click', () => world?.setView(b.dataset.v)));

if (world) {
  world.rebuildSiphon();
  window.addEventListener('resize', world.resize);
  new ResizeObserver(world.resize).observe(view);
  world.resize();
  world.setView('iso');
}
ui.applyView();
ui.syncUI();
metrics.update();
elec.update();
drawCharts();

let chartsVisible = true;
new IntersectionObserver((e) => (chartsVisible = e[e.length - 1].isIntersecting)).observe($('charts'));

/* penyesuaian kualitas otomatis berdasarkan FPS */
let qN = 0;
let qT = 0;
let qWarm = 0;
let qLow = 0;
function autoTune(raw) {
  if (!world || raw >= 1) return;
  qWarm += raw;
  if (qWarm <= 3) return;
  qN++;
  qT += raw;
  if (qT < 3) return;
  const fps = qN / qT;
  qN = 0;
  qT = 0;
  if (autoQuality && world.quality < 3 && fps < 22) {
    if (++qLow >= 2) {
      qLow = 0;
      qWarm = 1.5;
      world.setQuality(world.quality + 1);
    }
  } else qLow = 0;
}

let last = performance.now();
let uiAcc = 0;
let chAcc = 0;
let elecTick = 0;
function frame(now) {
  const raw = Math.max(0, (now - last) / 1000);
  const real = Math.min(0.05, raw);
  last = now;

  const simdt = advance(real, ui.syncUI);
  flow.tick(real, simdt);
  if (world) {
    if (siphonDirty && now - siphonAt > 90) {
      siphonAt = now;
      siphonDirty = false;
      world.rebuildSiphon();
    }
    world.update(real, simdt);
    world.render();
  }
  // timer UI memakai waktu nyata (bukan dt yang dibatasi) supaya tetap responsif di perangkat lambat
  const wall = Math.min(1, raw);
  uiAcc += wall;
  if (uiAcc > 0.2) {
    uiAcc = 0;
    metrics.update();
    if (elecTick++ % 5 === 0) elec.update();
  }
  chAcc += wall;
  if (chAcc > 0.5) {
    chAcc = 0;
    if (chartsVisible) drawCharts();
  }
  autoTune(raw);
}
if (world) world.renderer.setAnimationLoop(frame);
else {
  const loop = (t) => {
    frame(t);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/* API diagnostik (dipakai uji otomatis Playwright) */
window.__sim = {
  get S() {
    return app.S;
  },
  get P() {
    return app.P;
  },
  get q() {
    return world?.quality;
  },
  get fs() {
    return app.flowStats;
  },
  get fmode() {
    return flow.mode;
  },
  get info() {
    return world ? { ...world.renderer.info.render, geometries: world.renderer.info.memory.geometries } : null;
  },
  app,
  flow,
  setView: (k) => world?.setView(k),
  /** majukan animasi garis arus n langkah (diagnostik) */
  flowAdvance: (n, dt) => world?.fviz.debugAdvance(n, dt),
};
