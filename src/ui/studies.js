/**
 * Studi terpandu: skenario sekali klik yang mengatur parameter, tampilan, dan kamera,
 * lalu memberi panduan apa yang perlu diperhatikan. Saat studi diakhiri, semua
 * pengaturan pengguna dikembalikan (studi tidak pernah menimpa pengaturan tersimpan).
 */
import { el } from '../util/format.js';

/** Matikan semua visualisasi arus & ornamen yang mengganggu; dipakai sebagai titik awal studi. */
function cleanView(a, keepOrnaments = true) {
  Object.assign(a.V, { planeOn: false, filterPlane: false, fog: false, tr3d: false, cfd: true });
  if (!keepOrnaments) Object.assign(a.V, { fish: false, coral: false, label: false, lamp: false });
}

const breakSiphons = (a) => {
  for (let i = 0; i < a.P.n; i++) {
    a.S.brk[i] = true;
    a.S.air[i] = 1;
    a.S.vs[i] = 0;
  }
};

export const STUDIES = [
  {
    id: 'padam',
    title: 'Uji padam listrik 60 detik',
    desc: 'Apakah tank meluap atau sump banjir saat listrik mati?',
    watch:
      'Lihat grafik "Level air": level tank turun sampai lubang siphon-break (±26,3 cm) lalu berhenti, chamber pompa naik. Bandingkan dengan metrik "Level bila listrik padam". Listrik menyala lagi otomatis setelah 60 detik.',
    view: 'front',
    setup(a) {
      cleanView(a);
      a.SPD = 4;
    },
    action(a) {
      a.P.on = false;
      a.tOn = a.S.t + 60;
    },
  },
  {
    id: 'putus',
    title: 'Siphon putus (skenario terburuk)',
    desc: 'Pompa terus mengisi tank sementara siphon berhenti mengalir.',
    watch:
      'Perhatikan status di pojok kiri atas dan metrik "Status pompa". Dengan pelampung atas, pompa mati di 28,5 cm; tanpa pelampung, tank meluap. Venturi dimatikan agar siphon tidak tersambung sendiri.',
    view: 'iso',
    setup(a) {
      cleanView(a);
      a.P.venturi = false;
      a.SPD = 6;
    },
    action: breakSiphons,
  },
  {
    id: 'tanpa-pelampung',
    title: 'Belum pasang pelampung',
    desc: 'Risiko bila pelampung atas & bawah belum terpasang, ATO tetap aktif, lalu siphon putus.',
    watch:
      'Metrik "Status pompa" berubah merah "jalan kering!", dan ATO terus menambah air sampai tank meluap. Ulangi dengan pelampung terpasang (tab Tank → Pompa return) untuk membandingkan.',
    view: 'iso',
    setup(a) {
      cleanView(a);
      Object.assign(a.P, { fswHi: false, fswLo: false, ato: true, venturi: false });
      a.SPD = 10;
    },
    action: breakSiphons,
  },
  {
    id: 'air-baru',
    title: 'Air baru dari filter mengisi tank',
    desc: 'Bagaimana air yang baru keluar dari filter menyebar, lalu tersedot kembali ke intake?',
    watch:
      'Kabut menandai air yang keluar dari duckbill (pewarna terus-menerus). Perhatikan jalur jet, area yang lama terisi (ruang mati), lalu air bertanda masuk intake dan muncul di filter. Metrik "Air baru tank / filter" (tab Metrik) naik menuju 100%; waktu khasnya = waktu tinggal τ (±5 menit).',
    view: 'iso',
    setup(a) {
      cleanView(a, false);
      a.V.fog = true;
      Object.assign(a.FV, { value: 'dye', fogMode: 'fast' });
      a.SPD = 10;
    },
    action(a, ctx) {
      ctx?.flow.startDye('cont');
    },
  },
  {
    id: 'umur-air',
    title: 'Umur air & ruang mati',
    desc: 'Di mana air paling lama tidak tergantikan oleh air dari filter?',
    watch:
      'Kabut menyorot air tua (umur tinggi) = ruang mati sebenarnya. Metrik "Umur air rata-rata", "Efisiensi pertukaran air" (50% = campur sempurna; lebih rendah = ada jalan pintas/ruang mati) dan "Air tua" ada di tab Metrik. Butuh ±10 menit simulasi untuk stabil.',
    view: 'iso',
    setup(a) {
      cleanView(a, false);
      a.V.fog = true;
      Object.assign(a.FV, { value: 'age', fogMode: 'fast' });
      a.SPD = 20;
    },
  },
  {
    id: 'ato-salinitas',
    title: 'ATO & salinitas lokal',
    desc: 'Ke mana air tawar dari ATO pergi sebelum tercampur?',
    watch:
      'Level chamber pompa diturunkan 2,5 cm — setara penguapan ±250 mL air tawar (garam tertinggal, salinitas naik sedikit) — sehingga ATO menyala. Kabut menyorot air yang lebih tawar dari tetesan ATO; gaya apung membuatnya cenderung di permukaan sebelum teraduk terjunan weir dan tersedot pompa. Metrik "Salinitas" dan "Salinitas lokal" ada di tab Metrik.',
    view: 'back',
    setup(a) {
      cleanView(a, false);
      a.P.ato = true;
      a.V.fog = true;
      Object.assign(a.FV, { value: 'salt', fogMode: 'low' });
      a.SPD = 3;
    },
    action(a) {
      a.S.HP -= 2.5;
    },
  },
  {
    id: 'kapas',
    title: 'Kapas mampet 85%',
    desc: 'Bagaimana kapas yang kotor menaikkan level chamber pertama?',
    watch:
      'Metrik "Ch 1 kapas / Ch 2" (tab Metrik): selisih level makin besar. Bila chamber kapas mendekati bibir 30 cm, air bisa meluber melewati kapas. Bidang filter menunjukkan aliran tertahan di kapas.',
    view: 'back',
    setup(a) {
      cleanView(a);
      a.P.clog = 0.85;
      a.V.filterPlane = true;
      a.FV.filterZ = 5;
      a.FV.value = 'inst';
      a.SPD = 6;
    },
  },
  {
    id: 'zona-mati',
    title: 'Peta zona mati tank & filter',
    desc: 'Di mana detritus kemungkinan mengendap?',
    watch:
      'Tunggu ±30 detik simulasi. Kabut merah–oranye = arus rata-rata < 1 cm/s. Lihat metrik "Zona mati". Coba ubah arah duckbill atau nyalakan wavemaker (tab Tank → Duckbill & wavemaker), lalu bandingkan.',
    view: 'iso',
    setup(a) {
      cleanView(a, false);
      a.V.fog = true;
      Object.assign(a.FV, { fogMode: 'dead', value: 'avg' });
      a.SPD = 8;
    },
  },
  {
    id: 'jet',
    title: 'Arah jet duckbill',
    desc: 'Ke mana arus return benar-benar mengalir di dalam tank?',
    watch:
      'Bidang tegak dari depan: garis arus memperlihatkan sirkulasi, kabut merah = jet kuat. Geser "Arah duckbill" (tab Tank → Duckbill & wavemaker) dan amati perubahannya setelah ±30 detik.',
    view: 'front',
    setup(a) {
      cleanView(a, false);
      a.V.planeOn = true;
      a.V.fog = true;
      Object.assign(a.FV, { orient: 'v', sliceZ: 12.5, fogMode: 'fast', value: 'inst' });
      a.SPD = 6;
    },
  },
  {
    id: 'filter',
    title: 'Aliran di dalam filter',
    desc: 'Bagaimana air melewati kapas, sela skimmer, media bio, dan riser?',
    watch:
      'Bidang filter 0,5 cm dari kaca belakang memperlihatkan air memutari badan skimmer. Geser "Posisi bidang filter" (tab Arus → Bidang potong) untuk melihat lapisan lain; di tengah (5 cm) terlihat pusaran chamber bio dan pompa.',
    view: 'back',
    setup(a) {
      cleanView(a, false);
      a.V.filterPlane = true;
      Object.assign(a.FV, { filterZ: 0.5, value: 'inst' });
      a.SPD = 6;
    },
  },
];

/**
 * @param {HTMLElement} root wadah tab Studi
 * @param {{start: (def) => void, end: () => void}} api
 */
export function buildStudies(root, api) {
  const card = el('div', { className: 'card' });
  card.append(
    el('p', {
      className: 'note',
      textContent:
        'Pilih skenario: parameter, tampilan, dan sudut kamera diatur otomatis. Pengaturanmu disimpan dulu dan dikembalikan saat studi diakhiri.',
    }),
  );
  // strip "sedang berjalan" di tab Studi sendiri: banner di atas panel sering di luar layar di HP
  const runTitle = el('b');
  const runEnd = el('button', { className: 'study-end', textContent: 'Akhiri' });
  runEnd.addEventListener('click', () => api.end());
  const running = el('div', { className: 'study-running', hidden: true, role: 'status' }, [el('span', { textContent: '▶ Sedang berjalan: ' }), runTitle, runEnd]);
  card.append(running);

  const list = el('div', { className: 'studies' });
  const btns = {};
  let activeId = null;
  let startedAt = 0;
  let relabel = 0;
  for (const def of STUDIES) {
    const btn = el('button', { className: 'study-go', textContent: 'Mulai' });
    btn.addEventListener('click', () => {
      // ketukan ganda/berulang pada studi yang baru dimulai tidak mengulang simulasi
      if (activeId === def.id && performance.now() - startedAt < 2500) return;
      api.start(def);
    });
    btns[def.id] = btn;
    list.append(
      el('div', { className: 'study' }, [el('div', {}, [el('b', { textContent: def.title }), el('span', { textContent: def.desc })]), btn]),
    );
  }
  card.append(list);
  root.append(card);

  const setButtons = () => {
    for (const [id, b] of Object.entries(btns)) {
      const on = id === activeId;
      b.classList.toggle('running', on);
      b.textContent = !on ? 'Mulai' : performance.now() - startedAt < 2500 ? 'Berjalan ✓' : 'Ulangi';
    }
  };

  const banner = document.getElementById('studyBanner');
  return {
    show(def) {
      activeId = def.id;
      startedAt = performance.now();
      setButtons();
      clearTimeout(relabel);
      relabel = setTimeout(setButtons, 2600);
      runTitle.textContent = def.title;
      running.hidden = false;
      const end = el('button', { className: 'study-end', textContent: 'Akhiri studi' });
      end.addEventListener('click', () => api.end());
      banner.replaceChildren(
        el('div', { className: 'study-head' }, [el('b', { textContent: 'Studi: ' + def.title }), end]),
        el('p', { className: 'note', textContent: def.watch }),
      );
      banner.hidden = false;
    },
    hide() {
      activeId = null;
      clearTimeout(relabel);
      setButtons();
      running.hidden = true;
      banner.hidden = true;
      banner.replaceChildren();
    },
  };
}
