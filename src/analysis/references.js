/**
 * Pustaka untuk saran dan laporan analisis.
 *
 * Setiap entri sudah dicek bibliografinya (judul, jurnal, volume, halaman) dan DOI-nya pada
 * November 2026 lewat halaman penerbit/indeks. Entri tanpa `doi` = DOI tidak bisa dipastikan,
 * jadi sengaja tidak dicantumkan (lebih baik tanpa DOI daripada DOI salah).
 * `use` = untuk apa referensi itu dipakai di aplikasi (ringkasan temuan yang relevan).
 *
 * Tingkat bukti yang dipakai di saran:
 *   A = riset peer-reviewed (fisiologi karang & arus, salinitas)
 *   B = rumus/standar teknik & definisi (hidraulika, pencampuran, sifat air laut) — termasuk model aplikasi ini
 *   C = konsensus praktisi akuarium (bukan hasil jurnal) — ditandai jelas
 */
export const REFERENCES = [
  // ---------- arus & karang (A) ----------
  {
    id: 'jokiel1978',
    cite: 'Jokiel PL (1978) Effects of water motion on reef corals. Journal of Experimental Marine Biology and Ecology 35:87–97.',
    use: 'Gerak air memengaruhi pertumbuhan karang; arus juga bisa merugikan bila terlalu kuat (jaringan rusak, cabang patah).',
    ev: 'A',
  },
  {
    id: 'dennison1988',
    cite: 'Dennison WC, Barnes DJ (1988) Effect of water motion on coral photosynthesis and calcification. Journal of Experimental Marine Biology and Ecology 115:67–77.',
    doi: '10.1016/0022-0981(88)90190-6',
    use: 'Tanpa pengadukan, fotosintesis bersih & respirasi Acropora ±25% lebih rendah dan kalsifikasi gelap ±60% lebih rendah.',
    ev: 'A',
  },
  {
    id: 'atkinson1992',
    cite: 'Atkinson MJ, Bilger RW (1992) Effects of water velocity on phosphate uptake in coral reef-flat communities. Limnology and Oceanography 37:273–279.',
    doi: '10.4319/lo.1992.37.2.0273',
    use: 'Serapan fosfat naik seiring kecepatan air (dibatasi transfer massa): arus menentukan pasokan nutrien.',
    ev: 'A',
  },
  {
    id: 'shashar1993',
    cite: 'Shashar N, Cohen Y, Loya Y (1993) Extreme diel fluctuations of oxygen in diffusive boundary layers surrounding stony corals. Biological Bulletin 185:455–461.',
    doi: '10.2307/1542485',
    use: 'O₂ di lapisan batas difusi karang berayun dari jenuh berlebih (siang) sampai anoksia (malam); arus 5 cm/s menipiskan lapisan batas 2,44 → 1,90 mm.',
    ev: 'A',
  },
  {
    id: 'nakamura2001',
    cite: 'Nakamura T, van Woesik R (2001) Water-flow rates and passive diffusion partially explain differential survival of corals during the 1998 bleaching event. Marine Ecology Progress Series 212:301–304.',
    doi: '10.3354/meps212301',
    use: 'Arus lemah (±2–3 cm/s) berkaitan dengan kelangsungan hidup karang yang rendah saat pemutihan 1998.',
    ev: 'A',
  },
  {
    id: 'sebens2003',
    cite: 'Sebens KP, Helmuth B, Carrington E, Agius B (2003) Effects of water flow on growth and energetics of the scleractinian coral Agaricia tenuifolia in Belize. Coral Reefs 22:35–47.',
    doi: '10.1007/s00338-003-0277-6',
    use: 'Pertumbuhan lebih lambat di mikrohabitat berarus lemah; arus terlalu kuat (zona ombak) juga memperlambat dan menyebabkan kematian.',
    ev: 'A',
  },
  {
    id: 'finelli2006',
    cite: 'Finelli CM, Helmuth BST, Pentcheff ND, Wethey DS (2006) Water flow influences oxygen transport and photosynthetic efficiency in corals. Coral Reefs 25:47–57.',
    doi: '10.1007/s00338-005-0055-8',
    use: 'Efisiensi fotosintesis Agaricia agaricites naik pada arus 15 cm/s dibanding air diam; arus membantu membuang O₂ dari jaringan.',
    ev: 'A',
  },
  {
    id: 'mass2010',
    cite: 'Mass T, Genin A, Shavit U, Grinstein M, Tchernov D (2010) Flow enhances photosynthesis in marine benthic autotrophs by increasing the efflux of oxygen from the organism to the water. PNAS 107:2527–2531.',
    doi: '10.1073/pnas.0912348107',
    use: 'Arus meningkatkan fotosintesis karang terutama dengan mempercepat keluarnya O₂ dari jaringan; responsnya hampir seketika.',
    ev: 'A',
  },
  {
    id: 'schutter2010',
    cite: 'Schutter M, Crocker J, Paijmans A, Janse M, Osinga R, Verreth AJ, Wijffels RH (2010) The effect of different flow regimes on the growth and metabolic rates of the scleractinian coral Galaxea fascicularis. Coral Reefs 29:737–748.',
    doi: '10.1007/s00338-010-0617-2',
    use: 'Galaxea 42 minggu pada 0, 10, 20, 25 cm/s (dua arah): tanpa arus pertumbuhan nyata lebih rendah; 10 ≈ 20 cm/s; tertinggi pada 25 cm/s.',
    ev: 'A',
  },
  {
    id: 'osinga2011',
    cite: 'Osinga R, Schutter M, Griffioen B, Wijffels RH, Verreth JAJ, Shafir S, Henard S, Taruffi M, Gili C, Lavorano S (2011) The biology and economics of coral growth. Marine Biotechnology 13:658–671.',
    doi: '10.1007/s10126-011-9382-7',
    use: 'Tinjauan: arus menjaga pertukaran gas (O₂, CO₂), nutrien, dan buangan metabolik; arus kurang → sumber daya habis/zat penghambat menumpuk.',
    ev: 'A',
  },
  {
    id: 'leal2016',
    cite: 'Leal MC, Ferrier-Pagès C, Petersen D, Osinga R (2016) Coral aquaculture: applying scientific knowledge to ex situ production. Reviews in Aquaculture 8:136–153.',
    doi: '10.1111/raq.12087',
    use: 'Tinjauan budidaya karang ex situ: faktor lingkungan (termasuk arus) diatur untuk kualitas dan produktivitas.',
    ev: 'A',
  },
  // ---------- salinitas (A/B) ----------
  {
    id: 'millero2008',
    cite: 'Millero FJ, Feistel R, Wright DG, McDougall TJ (2008) The composition of Standard Seawater and the definition of the Reference-Composition Salinity Scale. Deep-Sea Research I 55:50–72.',
    doi: '10.1016/j.dsr.2007.10.001',
    use: 'Komposisi acuan air laut standar (salinitas praktis ±35); dasar target salinitas akuarium laut.',
    ev: 'B',
  },
  {
    id: 'kerswell2003',
    cite: 'Kerswell AP, Jones RJ (2003) Effects of hypo-osmosis on the coral Stylophora pistillata: nature and cause of "low-salinity bleaching". Marine Ecology Progress Series 253:145–154.',
    url: 'https://www.int-res.com/abstracts/meps/v253/p145-154',
    use: 'Air bersalinitas rendah memicu penurunan Fv/Fm alga simbion dan pemutihan karang, dalam terang maupun gelap.',
    ev: 'A',
  },
  {
    id: 'berkelmans2012',
    cite: 'Berkelmans R, Jones AM, Schaffelke B (2012) Salinity thresholds of Acropora spp. on the Great Barrier Reef. Coral Reefs 31:1103–1110.',
    doi: '10.1007/s00338-012-0930-z',
    use: 'Ambang salinitas Acropora dari banjir Fitzroy 2011: penurunan salinitas berkepanjangan menyebabkan kematian karang dangkal.',
    ev: 'A',
  },
  // ---------- pencampuran & umur air (B) ----------
  {
    id: 'danckwerts1953',
    cite: 'Danckwerts PV (1953) Continuous flow systems: distribution of residence times. Chemical Engineering Science 2:1–13.',
    doi: '10.1016/0009-2509(53)80001-1',
    use: 'Distribusi waktu tinggal & uji tracer (pewarna) untuk menilai jalan pintas dan ruang mati pada sistem aliran.',
    ev: 'B',
  },
  {
    id: 'sandberg1981',
    cite: 'Sandberg M (1981) What is ventilation efficiency? Building and Environment 16:123–135.',
    doi: '10.1016/0360-1323(81)90028-7',
    use: 'Umur rata-rata lokal & efisiensi pertukaran (50% = tercampur sempurna) — dipakai untuk "umur air" dan "efisiensi pertukaran air".',
    ev: 'B',
  },
  // ---------- hidraulika (B) ----------
  {
    id: 'moody1944',
    cite: 'Moody LF (1944) Friction factors for pipe flow. Transactions of the ASME 66:671–684.',
    doi: '10.1115/1.4018140',
    use: 'Faktor gesek Darcy–Weisbach untuk rugi tekanan di pipa siphon dan return.',
    ev: 'B',
  },
  {
    id: 'davies1950',
    cite: 'Davies RM, Taylor GI (1950) The mechanics of large bubbles rising through extended liquids and through liquids in tubes. Proceedings of the Royal Society A 200:375–390.',
    doi: '10.1098/rspa.1950.0023',
    use: 'Kecepatan naik gelembung besar di pipa (≈0,35·√(gD)) — dasar model kantong udara di puncak U-pipe.',
    ev: 'B',
  },
  {
    id: 'villemonte1947',
    cite: 'Villemonte JR (1947) Submerged-weir discharge studies. Engineering News-Record 139:866–869.',
    use: 'Koreksi debit weir yang tenggelam — dipakai untuk sekat weir filter dan bibir surface skimmer.',
    ev: 'B',
  },
  // ---------- akuakultur resirkulasi (B) ----------
  {
    id: 'chen1993',
    cite: 'Chen S, Timmons MB, Aneshansley DJ, Bisogni JJ (1993) Suspended solids characteristics from recirculating aquacultural systems and design implications. Aquaculture 112:143–155.',
    doi: '10.1016/0044-8486(93)90440-A',
    use: 'Padatan tersuspensi di sistem resirkulasi didominasi partikel halus (40–70% berat); perlu cara khusus untuk membuangnya.',
    ev: 'B',
  },
];

export const REF_INDEX = Object.fromEntries(REFERENCES.map((r, i) => [r.id, i + 1]));

/** Nomor rujukan [n] untuk daftar id. */
export const refNums = (ids = []) => ids.map((id) => REF_INDEX[id]).filter(Boolean);

export const EVIDENCE = {
  A: 'riset peer-reviewed',
  B: 'rumus/standar teknik & model aplikasi',
  C: 'konsensus praktisi akuarium (bukan jurnal)',
};

export const refLink = (r) => (r.doi ? `https://doi.org/${r.doi}` : r.url || '');
