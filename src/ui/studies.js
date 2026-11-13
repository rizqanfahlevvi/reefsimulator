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
      'Tunggu ±30 detik simulasi. Kabut merah–oranye = arus rata-rata < 1 cm/s. Lihat metrik "Zona mati". Coba ubah arah duckbill atau nyalakan wavemaker (tab Arus → Duckbill & wavemaker), lalu bandingkan.',
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
      'Bidang tegak dari depan: garis arus memperlihatkan sirkulasi, kabut merah = jet kuat. Geser "Duckbill mendatar/naik-turun" (tab Arus → Duckbill & wavemaker) dan amati perubahannya setelah ±30 detik.',
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
  const list = el('div', { className: 'studies' });
  for (const def of STUDIES) {
    const btn = el('button', { className: 'study-go', textContent: 'Mulai' });
    btn.addEventListener('click', () => api.start(def));
    list.append(
      el('div', { className: 'study' }, [el('div', {}, [el('b', { textContent: def.title }), el('span', { textContent: def.desc })]), btn]),
    );
  }
  card.append(list);
  root.append(card);

  const banner = document.getElementById('studyBanner');
  return {
    show(def) {
      const end = el('button', { className: 'study-end', textContent: 'Akhiri studi' });
      end.addEventListener('click', () => api.end());
      banner.replaceChildren(
        el('div', { className: 'study-head' }, [el('b', { textContent: 'Studi: ' + def.title }), end]),
        el('p', { className: 'note', textContent: def.watch }),
      );
      banner.hidden = false;
    },
    hide() {
      banner.hidden = true;
      banner.replaceChildren();
    },
  };
}
