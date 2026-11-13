/**
 * Profil biota → target arus & salinitas untuk saran.
 *
 * Angka target adalah ambang kerja untuk model CFD aplikasi ini (kisi 1–1,5 cm, laju rata-rata
 * 8 dtk), bukan angka mutlak. "rock*" = sel air yang menempel di batu (tempat karang diletakkan).
 * Untuk profil karang, arah & besarnya ambang mengikuti riset arus–karang (A); angka bulatnya
 * sendiri adalah pilihan konservatif aplikasi. Profil ikan saja (FOWLR) tidak punya dasar
 * jurnal spesifik di sini → C.
 */
export const PROFILES = {
  fowlr: {
    label: 'Ikan saja (FOWLR)',
    flow: { mean: 2, rock: null, rockDeadMax: null, deadMax: 35, bottom: 1 },
    sal: { ok: [33, 37], hard: [30, 38], ev: 'C' },
    flowEv: 'C',
    flowRefs: ['chen1993'],
    why:
      'Tanpa karang, arus terutama untuk mengaduk air (O₂ merata), membawa kotoran halus ke intake sebelum mengendap, dan menghindari sudut mati. ' +
      'Padatan di sistem resirkulasi didominasi partikel halus yang harus dibawa ke filter (Chen dkk. 1993). Ambang angkanya konsensus praktisi (C).',
  },
  soft: {
    label: 'Soft coral',
    flow: { mean: 2.5, rock: 3, rockDeadMax: 30, deadMax: 30, bottom: 1 },
    sal: { ok: [34, 36], hard: [32, 38], ev: 'B' },
    flowEv: 'A',
    flowRefs: ['nakamura2001', 'shashar1993', 'osinga2011'],
    why:
      'Arus menipiskan lapisan batas difusi sehingga O₂/CO₂ dan nutrien bertukar (Shashar 1993; Osinga 2011). Arus ±2–3 cm/s berkaitan dengan kelangsungan hidup karang rendah saat pemutihan (Nakamura & van Woesik 2001). ' +
      'Riset ini pada karang batu; untuk soft coral dipakai sebagai batas bawah (ekstrapolasi).',
  },
  lps: {
    label: 'Karang LPS',
    flow: { mean: 3, rock: 5, rockDeadMax: 20, deadMax: 25, bottom: 1 },
    sal: { ok: [34, 36], hard: [32, 38], ev: 'B' },
    flowEv: 'A',
    flowRefs: ['shashar1993', 'dennison1988', 'mass2010', 'schutter2010'],
    why:
      'Arus 5 cm/s menipiskan lapisan batas O₂ di permukaan karang (Shashar 1993). Tanpa pengadukan fotosintesis turun ±25% dan kalsifikasi gelap ±60% (Dennison & Barnes 1988); ' +
      'arus mempercepat keluarnya O₂ sehingga fotosintesis naik (Mass 2010). Tanpa arus, pertumbuhan Galaxea (LPS) nyata lebih rendah (Schutter 2010).',
  },
  sps: {
    label: 'Karang SPS',
    flow: { mean: 5, rock: 10, rockDeadMax: 10, deadMax: 15, bottom: 1 },
    sal: { ok: [34, 36], hard: [32, 38], ev: 'B' },
    flowEv: 'A',
    flowRefs: ['schutter2010', 'finelli2006', 'dennison1988', 'jokiel1978'],
    why:
      'Pertumbuhan Galaxea pada 10–20 cm/s setara dan tertinggi pada 25 cm/s (Schutter 2010); efisiensi fotosintesis naik pada 15 cm/s (Finelli 2006); Acropora tanpa pengadukan kehilangan ±60% kalsifikasi gelap (Dennison & Barnes 1988). ' +
      'Arus terlalu kuat juga bisa merusak jaringan (Jokiel 1978).',
  },
  mixed: {
    label: 'Campuran reef (soft + LPS + SPS)',
    flow: { mean: 3, rock: 5, rockDeadMax: 15, deadMax: 20, bottom: 1 },
    sal: { ok: [34, 36], hard: [32, 38], ev: 'B' },
    flowEv: 'A',
    flowRefs: ['shashar1993', 'schutter2010', 'osinga2011'],
    why:
      'Target mengikuti LPS di sekitar batu dengan zona mati lebih ketat; tempatkan SPS di jalur arus terkuat. Dasar: lapisan batas difusi (Shashar 1993), pertumbuhan vs arus (Schutter 2010), tinjauan budidaya (Osinga 2011).',
  },
};

export const PROFILE_OPTIONS = Object.entries(PROFILES).map(([k, p]) => [k, p.label]);
