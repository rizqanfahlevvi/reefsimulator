/** Panel kontrol: slider, toggle, pilihan pipa/skimmer/kualitas/tampilan, tombol cepat. */
import { app, emit, waterLitres, salinity, resetState } from '../state.js';
import { defaultParams, initialState, isFloating } from '../physics/hydraulics.js';
import { buildSkimCard } from './skimcard.js';
import { fmt, $, el } from '../util/format.js';
import { COLORMAPS, COLORMAP_LABELS } from '../render/colormaps.js';
import { QUANTITY_OPTIONS } from '../render/quantity.js';

const GROUPS = ['Air', 'Pompa return', 'Siphon U-pipe', 'Arus & visualisasi CFD', 'Filter dan pengaman', 'Ornamen', 'Tampilan dan simulasi', 'Skimmer, latar, dan lampu'];
/** Grup yang terbuka saat halaman dimuat (kosong = semua tertutup, panel ringkas). */
const OPEN_GROUPS = new Set();

/**
 * @param {object} h hooks: rebuildSiphon, applyView, applyGlass, applyBg, applyStyle, setQuality, setAutoQuality, resetFlow, updElec
 */
export function buildControls(h) {
  const S = () => app.S;
  const P = () => app.P;
  const markSiphon = () => emit('siphon-dirty');

  const SL = [
    {
      g: 0, id: 'vol', label: 'Volume air yang diisi', min: 28, max: 44, step: 0.1, d: 1, unit: ' L',
      get: () => app.volS,
      set: (v) => {
        S().pend += (v - app.volS) * 1000;
        app.volS = v;
      },
    },
    {
      g: 0, id: 'disp', label: 'Batu dan pasir (menggantikan air)', min: 0, max: 10, step: 0.5, d: 1, unit: ' L',
      get: () => P().disp,
      set: (v) => {
        const c = salinity();
        const d = v - P().disp;
        P().disp = v;
        app.volS -= d;
        S().salt = c * waterLitres();
        const u = U.vol;
        u.inp.value = app.volS;
        u.out.textContent = fmt(app.volS, 1) + ' L';
      },
    },
    { g: 1, id: 'spd', label: 'Daya pompa', min: 30, max: 100, step: 1, d: 0, unit: '%', get: () => P().spd * 100, set: (v) => (P().spd = v / 100) },
    { g: 1, id: 'qmax', label: 'Debit maks pompa (F-max)', min: 200, max: 1500, step: 50, d: 0, unit: ' L/jam', get: () => P().qmax, set: (v) => (P().qmax = v) },
    { g: 1, id: 'hmax', label: 'Tinggi angkat maks (H-max)', min: 0.3, max: 2, step: 0.1, d: 1, unit: ' m', get: () => P().hmax, set: (v) => (P().hmax = v) },
    { g: 1, id: 'rv', label: 'Ball valve return', min: 5, max: 100, step: 1, d: 0, unit: '%', get: () => P().rv * 100, set: (v) => (P().rv = v / 100) },
    { g: 2, id: 'zd', label: 'Tinggi ujung buang siphon', min: 18, max: 27, step: 0.1, d: 1, unit: ' cm', get: () => P().zd, set: (v) => { P().zd = v; markSiphon(); } },
    { g: 2, id: 'zin', label: 'Tinggi intake bawah dari dasar', min: 2, max: 22, step: 0.5, d: 1, unit: ' cm', get: () => P().zin, set: (v) => { P().zin = v; markSiphon(); } },
    { g: 2, id: 'kb', label: 'Bukaan intake bawah', min: 5, max: 100, step: 1, d: 0, unit: '%', get: () => P().kb * 100, set: (v) => (P().kb = v / 100) },
    { g: 2, id: 'zrim', label: 'Tinggi bibir surface skimmer (tipe tetap)', min: 22, max: 29.5, step: 0.1, d: 1, unit: ' cm', get: () => P().zrim, set: (v) => { P().zrim = v; markSiphon(); } },
    { g: 2, id: 'sv', label: 'Ball valve U-pipe', min: 5, max: 100, step: 1, d: 0, unit: '%', get: () => P().sv * 100, set: (v) => (P().sv = v / 100) },
    { g: 2, id: 'fsub', label: 'Kedalaman bibir skimmer apung di bawah muka air', min: 2, max: 15, step: 1, d: 0, unit: ' mm', get: () => P().fsub, set: (v) => (P().fsub = v) },
    {
      g: 2, id: 'tmid', label: 'Tinggi bibir di tengah ruang luncur', min: 20, max: 29.5, step: 0.1, d: 1, unit: ' cm',
      get: () => P().tmid, set: (v) => { P().tmid = v; markSiphon(); },
    },
    {
      g: 2, id: 'tstroke', label: 'Panjang ruang luncur (naik-turun kepala)', min: 1, max: 8, step: 0.5, d: 1, unit: ' cm',
      get: () => P().tstroke, set: (v) => { P().tstroke = v; markSiphon(); },
    },
    {
      g: 2, id: 'bleed', label: 'Lubang cadangan di pipa skimmer (Ø, tinggi 20 cm)', min: 0, max: 12, step: 1, d: 0, unit: ' mm',
      show: (v) => (v === 0 ? 'tanpa' : fmt(v, 0) + ' mm'), get: () => P().bleed, set: (v) => { P().bleed = v; markSiphon(); },
    },
    {
      g: 2, id: 'cap', label: 'Dop berlubang di ujung buang pipa skimmer (Ø)', min: 0, max: 16, step: 1, d: 0, unit: ' mm',
      show: (v) => (v === 0 ? 'tanpa dop' : fmt(v, 0) + ' mm'), get: () => P().cap, set: (v) => { P().cap = v; markSiphon(); },
    },
    {
      g: 2, id: 'sv2', label: 'Ball valve U skimmer', min: 5, max: 100, step: 1, d: 0, unit: '%',
      show: (v) => (v >= 100 ? 'tanpa valve / terbuka' : fmt(v, 0) + '%'), get: () => P().sv2 * 100, set: (v) => { P().sv2 = v / 100; markSiphon(); },
    },
    { g: 4, id: 'clog', label: 'Kapas kotor', min: 0, max: 95, step: 1, d: 0, unit: '%', get: () => P().clog * 100, set: (v) => (P().clog = v / 100) },
    { g: 3, id: 'nyaw', label: 'Arah duckbill mendatar (0° lurus ke kiri, + ke depan)', min: -90, max: 90, step: 5, d: 0, unit: '°', get: () => app.NZL.yaw, set: (v) => (app.NZL.yaw = v) },
    { g: 3, id: 'npit', label: 'Arah duckbill naik/turun (+ ke atas)', min: -60, max: 45, step: 5, d: 0, unit: '°', get: () => app.NZL.pitch, set: (v) => (app.NZL.pitch = v) },
    { g: 3, id: 'sliceY', label: 'Tinggi bidang potong mendatar', min: 1, max: 28, step: 0.5, d: 1, unit: ' cm', get: () => app.sliceY, set: (v) => (app.sliceY = v), auto: () => planeAt('h') },
    { g: 3, id: 'filterZ', label: 'Posisi bidang filter (dari kaca belakang filter)', min: 0.5, max: 9.5, step: 0.5, d: 1, unit: ' cm', get: () => app.FV.filterZ, set: (v) => (app.FV.filterZ = v), auto: () => ensureViz('filterPlane') },
    { g: 3, id: 'sliceZ', label: 'Posisi bidang tegak (dari kaca belakang)', min: 1, max: 24, step: 0.5, d: 1, unit: ' cm', get: () => app.FV.sliceZ, set: (v) => (app.FV.sliceZ = v), auto: () => planeAt('v') },
    {
      g: 3, id: 'vmax', label: 'Batas atas skala warna', min: 0, max: 30, step: 1, d: 0, unit: ' cm/s',
      show: (v) => (v === 0 ? 'otomatis' : fmt(v, 0) + ' cm/s'),
      get: () => app.FV.vmax,
      set: (v) => (app.FV.vmax = v),
      auto: () => ensureAnyViz(),
    },
    { g: 3, id: 'mapAlpha', label: 'Kepekatan peta warna', min: 0, max: 100, step: 5, d: 0, unit: '%', get: () => app.FV.mapAlpha * 100, set: (v) => (app.FV.mapAlpha = v / 100), auto: () => ensurePlane() },
    { g: 3, id: 'fogDensity', label: 'Kepekatan kabut', min: 0.1, max: 3, step: 0.1, d: 1, unit: '×', get: () => app.FV.fogDensity, set: (v) => (app.FV.fogDensity = v), auto: () => ensureViz('fog') },
    { g: 3, id: 'anim', label: 'Kecepatan animasi garis arus', min: 0.5, max: 5, step: 0.5, d: 1, unit: '×', get: () => app.FV.anim, set: (v) => (app.FV.anim = v), auto: () => ensurePlane() },
    { g: 3, id: 'wq', label: 'Debit wavemaker', min: 300, max: 3000, step: 100, d: 0, unit: ' L/jam', get: () => app.WM.q, set: (v) => (app.WM.q = v) },
    { g: 3, id: 'wyaw', label: 'Wavemaker mendatar (+ ke depan)', min: -80, max: 80, step: 5, d: 0, unit: '°', get: () => app.WM.yaw, set: (v) => (app.WM.yaw = v) },
    { g: 3, id: 'wpit', label: 'Wavemaker naik/turun (+ ke atas)', min: -45, max: 45, step: 5, d: 0, unit: '°', get: () => app.WM.pitch, set: (v) => (app.WM.pitch = v) },
    { g: 3, id: 'wy', label: 'Tinggi wavemaker', min: 5, max: 25, step: 1, d: 0, unit: ' cm', get: () => app.WM.y, set: (v) => (app.WM.y = v) },
    { g: 6, id: 'tint', label: 'Kepekatan warna kaca', min: 0, max: 100, step: 5, d: 0, unit: '%', get: () => app.glassTint * 100, set: (v) => { app.glassTint = v / 100; h.applyGlass(); } },
    { g: 7, id: 'li', label: 'Kecerahan lampu', min: 10, max: 100, step: 5, d: 0, unit: '%', get: () => app.LOOK.li, set: (v) => (app.LOOK.li = v) },
    { g: 6, id: 'sp', label: 'Kecepatan simulasi', min: 1, max: 20, step: 1, d: 0, unit: '×', get: () => app.SPD, set: (v) => (app.SPD = v) },
  ];
  const TG = [
    { g: 2, id: 'venturi', label: 'Selang udara ke venturi / aqualifter' },
    { g: 2, id: 'vent2', label: 'Aqualifter / venturi di U skimmer (susunan terpisah)' },
    { g: 2, id: 'box', label: 'Overflow box (sisir 26,5 cm) sebagai surface skimmer' },
    { g: 3, id: 'cfd', view: true, label: 'Simulasi arus (CFD) di tank dan filter' },
    { g: 3, id: 'planeOn', view: true, label: 'Bidang potong tank: peta kecepatan + garis arus (animasi)' },
    { g: 3, id: 'filterPlane', view: true, label: 'Bidang potong filter: peta kecepatan + garis arus' },
    { g: 3, id: 'fog', view: true, label: 'Kabut kecepatan 3D (seluruh volume tank + filter)' },
    { g: 3, id: 'tr3d', view: true, label: 'Jejak partikel 3D (titik + ekor)' },
    { g: 3, id: 'wm', view: true, label: 'Wavemaker di kaca kanan' },
    { g: 4, id: 'hole', label: 'Lubang siphon-break di return (26,3 cm)' },
    { g: 1, id: 'fswHi', label: 'Auto-off pompa: pelampung atas di tank (mati di 28,5 cm, cegah banjir)' },
    { g: 1, id: 'fswLo', label: 'Auto-off pompa: pelampung bawah di chamber pompa (mati di 4 cm, cegah pompa kering)' },
    { g: 4, id: 'ato', label: 'ATO aktif (setpoint 18 cm, reservoir 2 L)' },
    { g: 5, id: 'fish', view: true, label: 'Ikan' },
    { g: 5, id: 'coral', view: true, label: 'Karang' },
    { g: 5, id: 'rock', view: true, label: 'Batu hidup (ikut menghalangi arus)' },
    { g: 5, id: 'sand', view: true, label: 'Pasir' },
    { g: 5, id: 'lamp', view: true, label: 'Lampu LED' },
    { g: 5, id: 'room', view: true, label: 'Lemari dan ruangan' },
    { g: 6, id: 'flow', view: true, label: 'Penanda aliran di dalam pipa (siphon & selang return)' },
    { g: 6, id: 'clear', view: true, label: 'Pipa bening (lihat air dan udara di dalam)' },
    { g: 6, id: 'label', view: true, label: 'Label nama' },
    { g: 6, id: 'hot', view: true, label: 'Penanda komponen yang bisa diketuk (titik)' },
  ];

  const U = {};
  const root = $('controls');
  const gs = GROUPS.map((t, i) => {
    const d = el('details', { open: OPEN_GROUPS.has(i) }, [el('summary', { textContent: t })]);
    root.append(d);
    return d;
  });

  const selectRow = (parent, label, id, opts, onChange, before = null) => {
    const l = el('label', { className: 'row', htmlFor: id, textContent: label });
    const k = el('select', { id, style: 'width:100%' }, opts.map(([v, t]) => el('option', { value: v, textContent: t })));
    k.addEventListener('change', () => onChange(k.value));
    parent.insertBefore(l, before);
    parent.insertBefore(k, before);
    return k;
  };

  for (const s of SL) {
    const out = el('b');
    const l = el('label', { className: 'row', htmlFor: 's_' + s.id }, [el('span', { textContent: s.label }), out]);
    const inp = el('input', { type: 'range', id: 's_' + s.id, min: s.min, max: s.max, step: s.step });
    gs[s.g].append(l, inp);
    U[s.id] = { inp, out, def: s };
    inp.addEventListener('input', () => {
      s.set(+inp.value);
      out.textContent = s.show ? s.show(+inp.value) : fmt(+inp.value, s.d) + s.unit;
      s.auto?.();
    });
  }

  selectRow(gs[2], 'Susunan intake', 'layout', [
    ['1', '1 U-pipe: intake bawah + skimmer lewat tee'],
    ['split', '2 U-pipe terpisah: pipa bawah + pipa khusus skimmer'],
  ], (val) => {
    const p = P();
    p.split = val === 'split';
    p.n = p.split ? 2 : 1;
    if (p.split && p.sk === 0) p.sk = 2;
    // pipa baru mulai terpancing penuh (tanpa udara)
    for (let i = 0; i < 2; i++) {
      S().brk[i] = false;
      S().air[i] = 0;
      if (i >= p.n) S().vs[i] = 0;
    }
    h.rebuildSiphon();
    syncUI();
  });
  selectRow(gs[2], 'Ukuran U-pipe', 'pipe', [
    ['1.8', 'PVC ½" (dalam 18 mm)'],
    ['2.2', 'PVC ¾" (dalam 22 mm)'],
    ['1.7', 'TY 20 mm (dalam 17 mm)'],
  ], (val) => {
    const p = P();
    p.D = +val;
    p.n = p.split ? 2 : 1;
    if (!p.split) p.sv = p.box ? 1 : defaultParams().sv;
    for (let i = p.n; i < 2; i++) {
      S().brk[i] = false;
      S().air[i] = 0;
      S().vs[i] = 0;
    }
    h.rebuildSiphon();
    syncUI();
  });
  selectRow(gs[2], 'Surface skimmer di intake', 'skt', [
    ['1', 'Mangkuk bercelah, tinggi tetap (PVC)'],
    ['2', 'Kepala mengapung (model kaca)'],
    ['3', 'Kepala apung teleskopik (bilah spiral, tabung bening)'],
    ['0', 'Tanpa surface skimmer'],
  ], (val) => {
    P().sk = +val;
    h.rebuildSiphon();
    syncUI();
  });
  selectRow(gs[6], 'Gaya tampilan', 'stylesel', [
    ['real', 'Realistis (bawaan)'],
    ['clay', 'Clay — claymorphism (panel & 3D pastel)'],
  ], (v) => {
    app.LOOK.style = v;
    h.applyStyle();
  }).value = app.LOOK.style;
  selectRow(gs[6], 'Kualitas grafis', 'qual', [
    ['a', 'Otomatis (menyesuaikan perangkat)'],
    ['0', 'Tinggi (+ bayangan halus/AO)'],
    ['2', 'Sedang'],
    ['3', 'Hemat'],
  ], (val) => {
    app.quality = val;
    if (val === 'a') h.setAutoQuality(true);
    else {
      h.setAutoQuality(false);
      h.setQuality(+val);
    }
  }).value = app.quality;

  for (const t of TG) {
    const c = el('input', { type: 'checkbox', id: 't_' + t.id });
    gs[t.g].append(el('label', { className: 'tg' }, [c, el('span', { textContent: t.label })]));
    U[t.id] = { chk: c };
    c.addEventListener('change', () => {
      if (t.view) {
        app.V[t.id] = c.checked;
        if (t.id === 'clear') h.rebuildSiphon();
        applyView();
        return;
      }
      const p = P();
      p[t.id] = c.checked;
      if (t.id === 'box') {
        h.resetFlow();
        if (c.checked) {
          p.sv = 1;
          p.zd = 21.5;
        } else {
          const d = defaultParams();
          p.sv = p.n === 1 ? d.sv : 0.25;
          p.zd = d.zd;
        }
        app.S = initialState(p);
        app.hist.length = 0;
        app.volS = waterLitres();
        syncUI();
      }
      h.rebuildSiphon();
    });
  }

  /* arus: pilihan visualisasi, legenda jejak 3D, catatan */
  selectRow(gs[3], 'Arah bidang potong tank', 'fvOrient', [
    ['h', 'Mendatar (lihat dari atas / miring)'],
    ['v', 'Tegak memanjang (lihat dari depan)'],
  ], (v) => planeAt(v)).value = app.FV.orient;
  selectRow(gs[3], 'Sorot pada kabut 3D', 'fvFogMode', [
    ['fast', 'Nilai tinggi menonjol (jet / air tua / pewarna)'],
    ['dead', 'Zona mati (laju < 1 cm/s)'],
    ['low', 'Nilai rendah menonjol (mis. air tawar ATO)'],
    ['all', 'Semua nilai'],
  ], (v) => {
    app.FV.fogMode = v;
    ensureViz('fog');
  }).value = app.FV.fogMode;
  selectRow(gs[3], 'Besaran yang ditampilkan', 'fvValue', QUANTITY_OPTIONS, (v) => {
    app.FV.value = v;
    fitFogMode();
    ensureAnyViz();
  }).value = app.FV.value;

  /* pewarna "air baru dari filter" */
  const dyeStatus = el('span', { className: 'dye-status', textContent: 'Pewarna: tidak dilepas' });
  const dyeBox = el('div', {}, [
    el('p', {
      className: 'note',
      textContent:
        'Tandai air yang keluar dari duckbill, lalu lihat bagaimana air itu menyebar di tank, tersedot intake, melewati filter, dan kembali. Besaran "Air baru dari filter (%)" dan kabut 3D dinyalakan otomatis bila belum ada tampilan arus. ' +
        'Pulsa 20 dtk = ±1,8 L air bertanda; setelah tercampur ke ±37 L kadarnya tinggal ±5%, jadi skala warna menyesuaikan otomatis (lihat angka di legenda). Untuk melihat tank "terisi" air baru sampai penuh, pakai pewarna terus-menerus.',
    }),
  ]);
  {
    const b = el('div', { className: 'btns' });
    const mk = (text, fn) => {
      const e = el('button', { textContent: text });
      e.addEventListener('click', () => {
        fn();
        if (app.FV.value !== 'dye') {
          app.FV.value = 'dye';
          syncUI();
        }
        fitFogMode();
        ensureAnyViz(); // pewarna tidak terlihat tanpa kabut/bidang potong
      });
      b.append(e);
    };
    mk('Lepas pewarna 20 dtk', () => h.dye('pulse', 20));
    mk('Pewarna terus-menerus', () => h.dye('cont'));
    const clr = el('button', { textContent: 'Hapus pewarna' });
    clr.addEventListener('click', () => h.dye('clear'));
    b.append(clr);
    dyeBox.append(b, dyeStatus);
  }
  selectRow(gs[3], 'Palet warna', 'fvCmap', COLORMAPS.map((k) => [k, COLORMAP_LABELS[k]]), (v) => {
    app.FV.cmap = v;
    ensureAnyViz();
  }).value = app.FV.cmap;
  const legend3d = el('div', {
    className: 'lg',
    innerHTML:
      '<span><i style="background:#ed2e33"></i>&lt;1 cm/s (zona mati)</span><span><i style="background:#ffd633"></i>1–3 lemah</span><span><i style="background:#2ee69e"></i>3–8 sedang</span><span><i style="background:#e6faff;border:1px solid #9bb"></i>&gt;8 kuat</span>',
  });
  const note3 = el('p', {
    className: 'note',
    style: 'margin-top:6px',
    textContent:
      'Garis arus = jejak ribuan partikel yang terbawa arus pada bidang potong; warnanya mengikuti laju. Kabut 3D menampilkan laju di seluruh volume air sekaligus (paling berat untuk HP; turunkan kualitas grafis bila tersendat). Pola arus butuh ±30 detik simulasi untuk stabil setelah arah diubah. Model kisi 1,5 cm ini untuk membandingkan arah nozzle/wavemaker, bukan angka mutlak. Kontrol yang tampak redup berarti tampilannya sedang mati; mengubahnya langsung menyalakan tampilan itu.',
  });
  /* preset tampilan */
  let modeBtns = null;
  const STUDY = { fish: false, coral: false, lamp: false, room: false, label: false, cfd: true, planeOn: true, filterPlane: true, tr3d: false, flow: true };
  const FULL = { fish: true, coral: true, rock: true, sand: true, lamp: true, room: true, label: true, cfd: true, planeOn: false, filterPlane: false, tr3d: true };
  const setMode = (study) => {
    Object.assign(app.V, study ? STUDY : FULL);
    applyView();
    syncUI();
  };
  {
    const b = el('div', { className: 'btns' });
    const mk = (text, fn) => {
      const e = el('button', { textContent: text });
      e.addEventListener('click', fn);
      b.append(e);
    };
    mk('Mode studi aliran', () => setMode(true));
    mk('Mode rencana lengkap', () => setMode(false));
    modeBtns = b;
    gs[5].append(b);
  }
  // tombol cepat di tampilan 3D
  $('bFlow')?.addEventListener('click', () => setMode(!(app.V.planeOn || app.V.filterPlane)));

  /* skimmer, latar, lampu — disisipkan sebelum slider kecerahan */
  {
    const g7 = gs[7];
    const first = g7.querySelector('label.row');
    const dark = el('input', { type: 'checkbox', id: 't_dark', checked: app.LOOK.dark });
    g7.insertBefore(el('label', { className: 'tg' }, [dark, el('span', { textContent: 'Lampu ruangan mati (mode gelap)' })]), first);
    dark.addEventListener('change', () => {
      app.LOOK.dark = dark.checked;
      if (dark.checked && app.LOOK.lamp === 'off') {
        app.LOOK.lamp = 'mix';
        $('lampsel').value = 'mix';
      }
    });
    selectRow(g7, 'Tipe protein skimmer', 'sktype', [
      ['air', 'Aerator (batu kayu + pompa udara)'],
      ['ven', 'Pompa venturi (needle-wheel)'],
    ], (v) => {
      app.LOOK.skim = v;
      h.updElec();
    }, first).value = app.LOOK.skim;
    const cp = el('input', { type: 'color', id: 'bgColor', value: app.LOOK.bgc, style: app.LOOK.bg === 'custom' ? '' : 'display:none', ariaLabel: 'Warna latar' });
    selectRow(g7, 'Latar belakang tank', 'bgsel', [
      ['black', 'Hitam doff'],
      ['white', 'Putih doff'],
      ['gwhite', 'Putih glossy'],
      ['marine', 'Biru marine'],
      ['custom', 'Warna sendiri'],
      ['none', 'Tanpa latar (kaca bening)'],
    ], (v) => {
      app.LOOK.bg = v;
      cp.style.display = v === 'custom' ? '' : 'none';
      h.applyBg();
    }, first).value = app.LOOK.bg;
    g7.insertBefore(cp, first);
    cp.addEventListener('input', () => {
      app.LOOK.bgc = cp.value;
      h.applyBg();
    });
    selectRow(g7, 'Warna lampu', 'lampsel', [
      ['white', 'Putih terang (±10.000 K)'],
      ['cool', 'Putih kebiruan (±14.000 K)'],
      ['mix', 'Mix putih + biru (umum reef)'],
      ['blue', 'Marine blue / actinic'],
      ['purple', 'Biru-ungu (full spectrum)'],
      ['off', 'Lampu mati'],
    ], (v) => (app.LOOK.lamp = v), first).value = app.LOOK.lamp;
  }

  function applyView() {
    h.applyView();
    const { V } = app;
    // kontrol arus tidak pernah dikunci: mengubahnya menyalakan tampilan yang dibutuhkan (ensureViz).
    // Penanda redup hanya memberi tahu bahwa tampilannya sedang mati.
    const idle = (ids, off) => {
      for (const id of ids) {
        const e = $(id);
        const lab = e && document.querySelector(`label[for="${id}"]`);
        lab?.classList.toggle('idle', off);
        e?.classList.toggle('idle', off);
      }
    };
    const anyPlane = V.cfd && (V.planeOn || V.filterPlane);
    const anyViz = anyPlane || (V.cfd && V.fog);
    idle(['fvOrient', 's_sliceY', 's_sliceZ'], !(V.cfd && V.planeOn));
    idle(['s_filterZ'], !(V.cfd && V.filterPlane));
    idle(['s_mapAlpha', 's_anim'], !anyPlane);
    idle(['fvValue', 'fvCmap', 's_vmax'], !anyViz);
    idle(['fvFogMode', 's_fogDensity'], !(V.cfd && V.fog));
    const fb = $('bFlow');
    if (fb) {
      const on = V.planeOn || V.filterPlane;
      fb.textContent = on ? 'Tampilan penuh' : 'Peta arus';
      fb.classList.toggle('active', on);
    }
  }

  /** Nyalakan tampilan arus yang dibutuhkan kontrol yang sedang diubah (+ CFD), lalu beri tahu pengguna. */
  function ensureViz(...keys) {
    const LABEL = { cfd: 'Simulasi arus (CFD)', planeOn: 'Bidang potong tank', filterPlane: 'Bidang potong filter', fog: 'Kabut 3D' };
    const turned = [];
    for (const k of ['cfd', ...keys]) {
      if (k && !app.V[k]) {
        app.V[k] = true;
        turned.push(LABEL[k]);
      }
    }
    if (!turned.length) return;
    applyView();
    syncUI();
    h.notify?.(turned.join(' + ') + ' dinyalakan otomatis');
  }
  /** Mode sorot kabut yang menyembunyikan besaran terpilih (mis. "zona mati" atau "nilai rendah" untuk pewarna) diganti. */
  function fitFogMode() {
    const v = app.FV.value;
    const m = app.FV.fogMode;
    let want = m;
    if (v === 'dye' && (m === 'dead' || m === 'low')) want = 'fast';
    else if (v === 'age' && m === 'dead') want = 'fast';
    else if (v === 'salt' && m === 'dead') want = 'low';
    if (want === m) return;
    app.FV.fogMode = want;
    syncUI();
    const label = $('fvFogMode').selectedOptions[0]?.textContent || want;
    h.notify?.(`Sorot kabut diganti ke "${label}" supaya besaran ini terlihat`);
  }
  /** Besaran skalar (umur/pewarna/salinitas) paling jelas di kabut 3D; laju arus di bidang potong. */
  function ensureAnyViz() {
    const V = app.V;
    if (V.planeOn || V.filterPlane || V.fog) ensureViz();
    else ensureViz(['age', 'dye', 'salt'].includes(app.FV.value) ? 'fog' : 'planeOn');
  }
  function ensurePlane() {
    ensureViz(app.V.planeOn || app.V.filterPlane ? null : 'planeOn');
  }
  /** Bidang potong tank dengan arah tertentu ('h' mendatar, 'v' tegak). */
  function planeAt(o) {
    if (app.FV.orient !== o) {
      app.FV.orient = o;
      applyView();
      syncUI();
    }
    ensureViz('planeOn');
  }

  function syncUI() {
    for (const s of SL) {
      const u = U[s.id];
      const v = s.get();
      u.inp.value = v;
      u.out.textContent = s.show ? s.show(v) : fmt(v, s.d) + s.unit;
    }
    for (const t of TG) U[t.id].chk.checked = !!(t.view ? app.V[t.id] : app.P[t.id]);
    const p = P();
    $('pipe').value = String(p.D);
    const split = p.split && !p.box;
    $('layout').value = split ? 'split' : '1';
    $('layout').disabled = p.box;
    $('skt').value = String(p.sk);
    $('skt').disabled = p.box;
    const none = $('skt').querySelector('option[value="0"]');
    if (none) none.disabled = split; // pipa skimmer terpisah selalu punya kepala skimmer
    U.zin.inp.disabled = p.box;
    U.kb.inp.disabled = p.box;
    U.zrim.inp.disabled = p.box || p.sk !== 1;
    U.fsub.inp.disabled = p.box || !isFloating(p);
    U.tmid.inp.disabled = U.tstroke.inp.disabled = p.box || p.sk !== 3;
    for (const k of ['bleed', 'cap', 'sv2']) U[k].inp.disabled = !split;
    U.vent2.chk.disabled = !split;
    // tampilkan hanya kontrol yang berlaku untuk susunan & tipe skimmer saat ini
    const hide = (w, on) => w && w.hidden !== on && (w.hidden = on);
    hide(subIntake, p.box);
    hide(W.s_zin, p.box);
    hide(W.s_kb, p.box);
    hide(subSkim, p.box);
    hide(W.skt, p.box);
    hide(W.s_zrim, p.box || p.sk !== 1);
    hide(W.s_fsub, p.box || !isFloating(p));
    hide(W.s_tmid, p.box || p.sk !== 3);
    hide(W.s_tstroke, p.box || p.sk !== 3);
    for (const k of ['s_bleed', 's_cap', 's_sv2', 't_vent2']) hide(W[k], !split);
    hide(splitHint, !split);
    hide(W.layout, p.box);
    relabel(W.s_zin, split ? 'Tinggi intake pipa bawah dari dasar' : 'Tinggi intake bawah dari dasar');
    relabel(W.s_kb, split ? 'Bukaan intake pipa bawah' : 'Bukaan intake bawah');
    relabel(W.s_sv, split ? 'Ball valve pipa bawah' : 'Ball valve U-pipe');
    relabel(W.s_zd, split ? 'Tinggi ujung buang (kedua pipa)' : 'Tinggi ujung buang siphon');
    relabel(W.t_venturi, split ? 'Aqualifter / venturi di U pipa bawah' : 'Selang udara ke venturi / aqualifter');
    relabel(W.t_vent2, 'Aqualifter / venturi di U skimmer');
    skim.update();
    const b = $('bPow');
    b.textContent = p.on ? 'Listrik: nyala' : 'Listrik: mati';
    b.className = p.on ? 'on' : 'off';
    $('lgBox').style.display = p.box ? '' : 'none';
    $('bBrkAll').textContent = p.n === 2 ? 'Putuskan semua' : 'Putuskan siphon';
    // pilihan tampilan (dipakai saat studi dimulai/diakhiri)
    const setv = (id, v) => {
      const e = $(id);
      if (e && e.value !== String(v)) e.value = String(v);
    };
    setv('fvOrient', app.FV.orient);
    setv('fvValue', app.FV.value);
    setv('fvCmap', app.FV.cmap);
    setv('fvFogMode', app.FV.fogMode);
    setv('sktype', app.LOOK.skim);
    setv('bgsel', app.LOOK.bg);
    setv('lampsel', app.LOOK.lamp);
    setv('stylesel', app.LOOK.style);
    setv('qual', app.quality);
    if ($('t_dark')) $('t_dark').checked = app.LOOK.dark;
    if ($('bgColor')) $('bgColor').style.display = app.LOOK.bg === 'custom' ? '' : 'none';
  }

  /* tombol cepat */
  $('bPow').addEventListener('click', () => {
    P().on = !P().on;
    app.tOn = 0;
    syncUI();
  });
  $('bOut').addEventListener('click', () => {
    P().on = false;
    app.tOn = S().t + 60;
    syncUI();
  });
  $('bBrkAll').addEventListener('click', () => {
    for (let i = 0; i < P().n; i++) {
      S().brk[i] = true;
      S().air[i] = 1;
      S().vs[i] = 0;
    }
  });
  $('bPrime').addEventListener('click', () => {
    for (let i = 0; i < P().n; i++) {
      S().brk[i] = false;
      S().air[i] = 0;
    }
  });
  $('bPause').addEventListener('click', () => {
    app.paused = !app.paused;
    $('bPause').textContent = app.paused ? 'Lanjut' : 'Jeda';
  });
  // Reset = ulang simulasi (level air, siphon, riwayat) dengan pengaturan yang sedang dipakai
  $('bReset').addEventListener('click', () => {
    h.resetFlow();
    const vol = app.volS;
    app.P.on = true;
    resetState(app.P);
    app.S.pend = (vol - app.volS) * 1000; // pertahankan volume air pilihan pengguna
    app.volS = vol;
    app.tOn = 0;
    app.paused = false;
    $('bPause').textContent = 'Jeda';
    h.rebuildSiphon();
    syncUI();
  });

  /* info penyimpanan + kembalikan ke bawaan */
  const savedTxt = el('span', { textContent: 'Pengaturan tersimpan otomatis di browser ini.' });
  const bDefault = el('button', { textContent: 'Kembalikan ke bawaan', id: 'bDefaults' });
  bDefault.addEventListener('click', () => {
    if (window.confirm('Kembalikan SEMUA pengaturan (tank, tampilan, tabel listrik) ke bawaan? Halaman akan dimuat ulang.')) h.resetSettings();
  });
  const saveInfo = el('div', { className: 'saveinfo' }, [savedTxt, bDefault]);
  function markSaved() {
    const t = new Date();
    savedTxt.textContent = `Pengaturan tersimpan otomatis di browser ini · ${String(t.getHours()).padStart(2, '0')}.${String(t.getMinutes()).padStart(2, '0')}`;
  }

  const nozzleNote = el('p', {
    className: 'note',
    style: 'margin-top:6px',
    textContent:
      'Arah duckbill dan wavemaker bisa diatur kapan saja. Pengaruhnya pada pola arus terlihat di tab Arus (bidang potong, kabut 3D, jejak) setelah ±30 detik simulasi; level dan debit hidrolik tidak berubah.',
  });

  /* ---------- siphon & surface skimmer: kartu status + kontrol per bagian (hanya yang relevan) ---------- */
  const skim = buildSkimCard({ onFocus: () => h.focusSkimmer?.() });
  const sub = (t) => el('h4', { className: 'ctl-sub', textContent: t });
  /** Bungkus label + kontrol supaya bisa disembunyikan bila tidak berlaku. */
  const wrap = (id) => {
    const e = $(id);
    if (!e) return null;
    if (e.type === 'checkbox') return e.closest('label');
    const w = el('div', { className: 'ctl' });
    const lab = root.querySelector(`label[for="${id}"]`);
    if (lab) w.append(lab);
    w.append(e);
    return w;
  };
  const W = {};
  for (const id of ['layout', 'pipe', 'skt', 's_zd', 's_zin', 's_kb', 's_zrim', 's_fsub', 's_tmid', 's_tstroke', 's_sv', 's_bleed', 's_cap', 's_sv2', 't_venturi', 't_vent2', 't_box']) W[id] = wrap(id);
  const subIntake = sub('Intake bawah');
  const subSkim = sub('Surface skimmer');
  const splitHint = el('details', { className: 'ctl-why' }, [
    el('summary', { textContent: 'Kenapa pipa skimmer terpisah bisa putus?' }),
    el('p', {
      className: 'note',
      textContent:
        'Pipa skimmer hanya dipasok lewat bibir kepala skimmer (dan lubang cadangan). Bila siphon menarik lebih banyak dari yang bisa masuk, kepala skimmer kering dan udara ikut tersedot ("kelaparan"). Lubang cadangan memasok kekurangan dari bawah, bibir yang lebih dalam menambah pasokan, dop berlubang membatasi tarikan, aqualifter membuang udara di puncak U. Kecepatan di pipa harus melebihi ±0,35·√(g·D) supaya gelembung terbawa.',
    }),
  ]);
  /** Label kontrol bersama mengikuti susunan (1 pipa / pipa bawah). */
  const relabel = (w, text) => {
    const sp = w?.querySelector('span');
    if (sp && sp.textContent !== text) sp.textContent = text;
  };

  /* ================= tata letak: tab + grup ringkas ================= */
  const LAYOUT = [
    {
      id: 'tank',
      title: 'Tank',
      groups: [
        ['Air', ['s_vol', 's_disp']],
        ['Pompa return & auto-off', ['s_spd', 's_qmax', 's_hmax', 's_rv', 't_fswHi', 't_fswLo']],
        [
          'Siphon & surface skimmer',
          [
            skim.el,
            sub('Susunan'),
            W.layout,
            W.pipe,
            W.t_box,
            subIntake,
            W.s_zin,
            W.s_kb,
            subSkim,
            W.skt,
            W.s_zrim,
            W.s_fsub,
            W.s_tmid,
            W.s_tstroke,
            W.s_bleed,
            W.s_cap,
            splitHint,
            sub('Ujung buang & valve'),
            W.s_zd,
            W.s_sv,
            W.s_sv2,
            sub('Buang udara di puncak U'),
            W.t_venturi,
            W.t_vent2,
          ],
        ],
        ['Filter & pengaman', ['s_clog', 't_hole', 't_ato']],
        ['Duckbill & wavemaker', ['s_nyaw', 's_npit', 't_wm', 's_wq', 's_wyaw', 's_wpit', 's_wy', nozzleNote]],
      ],
    },
    {
      id: 'arus',
      title: 'Arus',
      groups: [
        ['Simulasi & jejak arus', ['t_cfd', 't_tr3d', legend3d, modeBtns, note3]],
        ['Bidang potong (peta + garis arus)', ['t_planeOn', 'fvOrient', 's_sliceY', 's_sliceZ', 't_filterPlane', 's_filterZ', 's_mapAlpha', 's_anim']],
        ['Besaran & warna', ['fvValue', 'fvCmap', 's_vmax']],
        ['Kabut 3D', ['t_fog', 'fvFogMode', 's_fogDensity']],
        ['Pewarna air baru', [dyeBox]],
      ],
    },
    { id: 'studi', title: 'Studi', content: [] },
    { id: 'analisis', title: 'Analisis', content: [] },
    {
      id: 'tampilan',
      title: 'Tampilan',
      groups: [
        ['Gaya tampilan', ['stylesel']],
        ['Ornamen', ['t_fish', 't_coral', 't_rock', 't_sand', 't_lamp', 't_room']],
        ['Simulasi & grafis', ['s_sp', 'qual', 's_tint', 't_flow', 't_clear', 't_label', 't_hot']],
        ['Skimmer, latar & lampu', ['t_dark', 'sktype', 'bgsel', 'bgColor', 'lampsel', 's_li']],
        ['Laporan masalah (diagnostik)', [h.diagBox]],
      ],
    },
    { id: 'metrik', title: 'Metrik', content: [$('metricsCard')] },
    { id: 'listrik', title: 'Listrik', content: [$('elec')] },
  ];
  const moveInto = (parent, item) => {
    if (!item) return;
    if (typeof item !== 'string') return parent.append(item);
    const e = $(item);
    if (!e) return;
    if (e.type === 'checkbox') return parent.append(e.closest('label'));
    const lab = root.querySelector(`label[for="${item}"]`);
    if (lab) parent.append(lab);
    parent.append(e);
  };
  const nav = el('div', { className: 'tabs', role: 'tablist', ariaLabel: 'Menu pengaturan' });
  const sections = {};
  const tabBtns = {};
  for (const t of LAYOUT) {
    const sec = el('section', { id: 'tab-' + t.id, role: 'tabpanel', hidden: true });
    if (t.groups) {
      const card = el('div', { className: 'card' });
      for (const [title, items] of t.groups) {
        const d = el('details', {}, [el('summary', { textContent: title })]);
        for (const it of items) moveInto(d, it);
        card.append(d);
      }
      sec.append(card);
    }
    for (const c of t.content || []) if (c) sec.append(c);
    sections[t.id] = sec;
    const btn = el('button', { className: 'tab', role: 'tab', textContent: t.title, id: 'tabbtn-' + t.id });
    btn.addEventListener('click', () => showTab(t.id));
    nav.append(btn);
    tabBtns[t.id] = btn;
  }
  // grup lama kini kosong → buang, lalu pasang navigasi + panel tab
  root.replaceChildren(nav, ...Object.values(sections), saveInfo);
  function showTab(id) {
    for (const [k, sec] of Object.entries(sections)) {
      sec.hidden = k !== id;
      tabBtns[k].setAttribute('aria-selected', String(k === id));
      tabBtns[k].classList.toggle('active', k === id);
    }
    h.onTab?.(id);
  }
  showTab('tank');

  function setDyeStatus(t) {
    const txt = 'Pewarna: ' + t;
    if (dyeStatus.textContent !== txt) dyeStatus.textContent = txt;
  }

  /** Buka tab + grup yang berisi elemen tertentu (mis. laporan diagnostik). */
  function reveal(node) {
    const sec = node?.closest('section[role="tabpanel"]');
    if (!sec) return;
    showTab(sec.id.replace('tab-', ''));
    const d = node.closest('details');
    if (d) d.open = true;
    node.scrollIntoView({ block: 'nearest' });
  }
  const currentTab = () => Object.keys(sections).find((k) => !sections[k].hidden) || '-';

  /** Lencana jumlah di tombol tab (mis. saran yang perlu perhatian). */
  function setTabBadge(id, n, level = '') {
    const b = tabBtns[id];
    if (!b) return;
    const t = n ? String(n) : '';
    if (b.dataset.badge !== t) b.dataset.badge = t;
    if (b.dataset.level !== level) b.dataset.level = level;
  }
  /** Tampilkan besaran tertentu (mis. pewarna saat uji pulsa) + nyalakan tampilan yang dibutuhkan. */
  function showQuantity(v) {
    app.FV.value = v;
    syncUI();
    fitFogMode();
    ensureAnyViz();
  }

  return { syncUI, applyView, markSaved, U, showTab, reveal, currentTab, setDyeStatus, setTabBadge, showQuantity, sections, studiesRoot: sections.studi, tick: skim.update };
}
