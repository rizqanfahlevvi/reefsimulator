/**
 * Titik masuk aplikasi: rakit simulasi hidrolik, mesin arus (worker), dunia 3D, dan UI.
 */
import './styles.css';
import { app, on, resetState } from './state.js';
import { advance } from './sim.js';
import { FlowClient } from './cfd/client.js';
import { buildControls } from './ui/controls.js';
import { buildMetrics } from './ui/metrics.js';
import { buildElectricity, EL } from './ui/electricity.js';
import { loadSettings, saveSettings, clearSettings, applySettings, snapshot, sanitize } from './settings.js';
import { buildStudies } from './ui/studies.js';
import { drawCharts } from './ui/charts.js';
import { $ } from './util/format.js';

const view = $('view');
let world = null;

/* pengaturan tersimpan: diterapkan sebelum UI, dunia 3D, dan simulasi dibangun */
{
  const saved = loadSettings(EL);
  if (saved) {
    applySettings(app, EL, saved);
    resetState(app.P); // kondisi awal sesuai parameter tersimpan (mis. overflow box)
    const vol = saved.top.volS;
    if (vol !== undefined) {
      app.S.pend = (vol - app.volS) * 1000; // volume air pilihan pengguna
      app.volS = vol;
    }
  }
}

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

let autoQuality = app.quality === 'a';
const hooks = {
  rebuildSiphon: () => world?.rebuildSiphon(),
  applyView: () => world?.applyView(),
  applyGlass: () => world?.applyGlass(),
  applyBg: () => world?.applyBg(),
  setQuality: (l) => world?.setQuality(l),
  setAutoQuality: (v) => (autoQuality = v),
  resetFlow: () => (flow.resetNext = true),
  updElec: () => elec.update(),
  resetSettings: () => {
    saveEnabled = false;
    clearTimeout(saveTimer);
    clearSettings();
    location.reload();
  },
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
  if (!autoQuality) world.setQuality(+app.quality);
  world.rebuildSiphon();
  window.addEventListener('resize', world.resize);
  new ResizeObserver(world.resize).observe(view);
  world.resize();
  world.setView('iso');
}
ui.applyView();
ui.syncUI();
metrics.update();

/* simpan otomatis (debounce 400 ms) setiap ada perubahan di panel, dan saat halaman ditinggalkan */
let saveEnabled = true;
let saveTimer = 0;
function persist() {
  // selama studi berjalan, pengaturan studi tidak disimpan (pengaturan pengguna tetap utuh)
  if (saveEnabled && !study && saveSettings(app, EL)) ui.markSaved();
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 400);
}
for (const ev of ['input', 'change']) $('panel').addEventListener(ev, scheduleSave);
$('panel').addEventListener('click', (e) => {
  if (e.target.closest('button') && e.target.id !== 'bDefaults') scheduleSave();
});
$('bFlow')?.addEventListener('click', scheduleSave);
const flush = () => {
  clearTimeout(saveTimer);
  persist();
};
window.addEventListener('pagehide', flush);

/* ================= studi terpandu ================= */
let study = null;
/** Ulang simulasi dengan parameter saat ini (volume air pilihan dipertahankan). */
function restartSim() {
  hooks.resetFlow();
  const vol = app.volS;
  app.P.on = true;
  resetState(app.P);
  app.S.pend = (vol - app.volS) * 1000;
  app.volS = vol;
  app.tOn = 0;
  app.paused = false;
  $('bPause').textContent = 'Jeda';
}
function refreshAll() {
  world?.rebuildSiphon();
  world?.applyGlass();
  world?.applyBg();
  ui.applyView();
  ui.syncUI();
  elec.update();
  metrics.update();
}
function restoreSnap(snap) {
  const s = sanitize(snap, EL.rows.map((r) => r.id));
  if (s) applySettings(app, EL, s);
}
const studies = buildStudies(ui.studiesRoot, {
  start(def) {
    if (study) restoreSnap(study.snap); // berganti studi: kembali dulu ke pengaturan pengguna
    flush(); // pastikan pengaturan pengguna terbaru tersimpan
    study = { def, snap: JSON.parse(JSON.stringify(snapshot(app, EL))) };
    def.setup(app);
    restartSim();
    def.action?.(app);
    refreshAll();
    if (def.view) world?.setView(def.view);
    studies.show(def);
  },
  end() {
    if (!study) return;
    restoreSnap(study.snap);
    study = null;
    restartSim();
    refreshAll();
    world?.setView('iso');
    studies.hide();
  },
});
document.addEventListener('visibilitychange', () => document.hidden && flush());
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
  get world() {
    return world;
  },
  setView: (k) => world?.setView(k),
  /** majukan animasi garis arus n langkah (diagnostik) */
  flowAdvance: (n, dt) => world?.fviz.debugAdvance(n, dt),
};
