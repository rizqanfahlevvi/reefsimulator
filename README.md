# Simulasi 3D Reef Tank + Back Filter

Simulator interaktif untuk tank 50×25×30 cm dengan back filter 50×11×30 cm:
siphon U-pipe (intake bawah + surface skimmer), pompa return dan duckbill, weir antar-chamber,
ATO, saklar pelampung, uji padam listrik, arus CFD di tank dan filter, serta estimasi biaya listrik.

## Menjalankan (lewat VS Code, tanpa banyak terminal)

1. Pasang [Node.js](https://nodejs.org) versi 20 atau lebih baru.
2. Buka folder repo di VS Code.
3. Sekali saja: buka **Terminal → New Terminal**, lalu jalankan `npm install`.
4. Di panel **Explorer**, buka bagian **NPM Scripts** (kalau tidak terlihat: klik kanan judul Explorer → centang *NPM Scripts*).
   Klik ▶ di samping:
   - `dev`: menjalankan server lokal dengan hot reload. Buka alamat yang muncul (biasanya http://localhost:5173).
   - `test`: menjalankan uji otomatis fisika dan CFD.
   - `build`: membuat versi siap-publish di folder `dist/`.
   - `preview`: mencoba hasil `build` secara lokal.

> File `index.html` sekarang hanya kerangka. Membukanya dengan dobel-klik **tidak akan jalan**;
> selalu gunakan `npm run dev` atau hasil `npm run build`.

## Publikasi (Vercel)

Situs di-deploy otomatis oleh Vercel (pengaturan di `vercel.json`):

- **Push ke `main`** → situs utama (production) diperbarui.
- **Push ke branch lain / Pull Request** → Vercel membuat *preview URL* sendiri, sehingga perubahan bisa dicoba
  (termasuk di HP) sebelum di-merge. Link-nya muncul sebagai komentar bot Vercel di PR dan di dashboard → *Deployments*.
- Build command `npm test && npm run build`: bila uji regresi fisika/CFD gagal, deploy dibatalkan dan situs lama tetap tayang.
- File di `assets/` (nama ber-hash) di-cache 1 tahun; `index.html` selalu diambil ulang, jadi pembaruan langsung terlihat.
- Header keamanan: CSP (hanya skrip dari domain sendiri + toolbar Vercel di preview), `nosniff`, `Referrer-Policy`,
  `Permissions-Policy` (kamera/mikrofon/lokasi dimatikan).

Preview URL bisa dibuka siapa pun yang tahu link-nya, kecuali *Deployment Protection* diaktifkan di
**Project Settings → Deployment Protection**.

Workflow `.github/workflows/ci.yml` menjalankan uji + build di GitHub Actions untuk setiap push ke `main` dan setiap PR
(tanda ✅/❌ di PR), terpisah dari deploy.

## Struktur kode

```
index.html              kerangka halaman
src/
  main.js               titik masuk: loop utama, perakitan modul
  state.js              state aplikasi bersama + event bus kecil
  sim.js                integrator langkah tetap (0,02 dtk) + riwayat grafik
  settings.js           simpan/muat pengaturan (localStorage) + validasi skema
  layout.js             posisi batu, duckbill, wavemaker, pipa (dipakai render dan CFD)
  physics/
    constants.js        konstanta & geometri tank (CGS)
    hydraulics.js       model hidrolik (identik numerik dengan versi 1)
  cfd/
    engine.js           konfigurasi tank 3D + filter 3D (geometri, level, sumber)
    mac3d.js            solver Navier–Stokes MAC 3D generik (adveksi, viskositas eddy, berpori, proyeksi)
    poisson.js          solver tekanan PCG + MIC(0)
    flow.worker.js      Web Worker
    client.js           penyusun pesan + sampling medan untuk jejak partikel
  render/
    context.js          renderer, kamera, lampu, environment
    materials.js        material (kaca: serapan Beer–Lambert + pantulan, kaustik)
    geom.js             helper geometri + StaticBatch (penggabung draw call)
    world.js            perakit scene + update per frame + kualitas
    flowviz.js          bidang potong CFD: peta warna + garis arus GPU
    flowfog.js          kabut kecepatan 3D (volume rendering ray marching)
    colormaps.js        palet Turbo/Plasma/Viridis (GLSL + JS dari koefisien yang sama)
    quantity.js         besaran yang ditampilkan (laju, umur air, pewarna, salinitas) + skala otomatis
    scene/*.js          ruangan, tank, aquascape, ikan, peralatan, air, siphon, partikel, jejak, label
  ui/                   kontrol + tab, metrik/status, grafik, listrik, studi terpandu
  diag.js               log kejadian & error global untuk laporan diagnostik (lokal)
  render/hotspots.js    area sentuh komponen 3D, pemilihan dengan sinar, sorotan, panah pengarah
  analysis/             saran (advisor), profil biota, pustaka, titik seimbang, uji pulsa, laporan Markdown
  plumb/                rakit pipa: katalog & dimensi, model rakitan, geometri fitting, editor 3D, daftar bahan
tests/                  Vitest: regresi hidrolik vs versi 1, solver Poisson, engine CFD, ketahanan klien
```

## Antarmuka

Panel dibagi menjadi tab **Tank · Arus · Studi · Analisis · Tampilan · Metrik · Listrik**; tombol cepat dan 6 metrik utama
(termasuk zona mati tank & filter) selalu terlihat di atas tab. Semua grup tertutup saat halaman dimuat.

Tab **Studi** berisi skenario sekali klik (uji padam, siphon putus, belum pasang pelampung, air baru dari filter
mengisi tank, umur air & ruang mati, ATO & salinitas lokal, kapas mampet, peta zona mati, arah jet duckbill,
aliran di filter). Studi mengatur parameter, tampilan, dan kamera, menampilkan
panduan "yang perlu diperhatikan", dan mengembalikan pengaturan pengguna saat diakhiri — selama studi berjalan,
pengaturan tersimpan tidak ditimpa (`src/ui/studies.js`).

**Jam simulasi** (pojok kiri atas tampilan 3D) menampilkan waktu simulasi sejak Reset dan berjalan mengikuti
kecepatan simulasi; jarumnya berputar sekali per menit simulasi. Ketuk jam untuk mengganti kecepatan
(1× → 3× → 10× → 20×). Baris kecil di bawahnya hanya muncul bila ada yang tertinggal: `nyata ±N×` bila perangkat
tidak sanggup mengejar kecepatan yang dipilih, dan `arus tertinggal mm:ss (N%)` bila simulasi arus (CFD), yang dihitung
terpisah, berjalan lebih lambat dari jam (wajar pada kecepatan tinggi). Simulasi hidrolik kini mengikuti jam nyata sampai
4 fps (`src/ui/clock.js`, `src/sim.js`).

**Komponen 3D yang bisa diketuk** (`src/render/hotspots.js`, `src/ui/inspector.js`): intake siphon, U-pipe & ujung
buang, duckbill, wavemaker, pompa return, kapas, dan ATO. Ketuk komponennya (atau penanda titiknya) → komponen tersorot
dan muncul kartu berisi info langsung (debit, level, status) dan pengaturan yang relevan. Kontrol di kartu adalah cermin
kontrol panel (nilai, logika, simpan otomatis, dan log tetap satu jalur). Di desktop kartu ada di pojok tampilan 3D; di
HP/tablet kartu menjadi lembar di bawah layar supaya tank tetap bisa diketuk dan diputar. Menyeret tetap memutar kamera;
hanya ketukan singkat tanpa geser yang memilih komponen. Penanda titik bisa dimatikan di tab Tampilan; komponen yang
sedang mati (wavemaker, ATO) ditandai "+".

**Seret untuk mengarahkan** (`src/ui/aim.js`): saat duckbill atau wavemaker dipilih, muncul panah arah dengan bola biru
(ukurannya tetap di layar). Seret bola (atau badan duckbill) → arah jet mengikuti jari di bidang layar; sudut dibulatkan
ke langkah slider (5°) dan dibatasi rentang slider. Seret badan wavemaker → tingginya bergeser di kaca (5–25 cm). Nilai
dikirim lewat slider panel, sehingga parameter, model 3D, sumber jet di CFD, metrik utama (mis. zona mati), saran di tab
Analisis, simpan otomatis, dan log berubah lewat satu jalur. Kartu duckbill/wavemaker menampilkan data arus utama
(zona mati, arus rata-rata, arus di sekitar batu) dengan tanda "arus menyesuaikan…" selama ±30 dtk simulasi arus setelah
diubah. Listener seret berjalan di fase capture sebelum OrbitControls dan hanya mengambil alih bila jari mengenai
pegangan; penanda komponen lain yang menumpuk di area komponen terpilih disembunyikan sementara.

Kontrol di tab **Arus** tidak pernah dikunci. Bila tampilannya sedang mati (kontrol tampak redup), mengubah kontrol
itu langsung menyalakan tampilan yang dibutuhkan (mis. memilih besaran "Umur air" menyalakan kabut 3D, menggeser tinggi
bidang potong menyalakan bidang potong tank) dan memberi tahu lewat pesan singkat di tampilan 3D. Saat jejak partikel 3D
aktif, legenda warnanya tampil di pojok tampilan 3D (merah = arus < 1 cm/s, bukan error).

## Rakit pipa (fase 1–3)

Tombol **Rakit pipa** di tampilan 3D membuka mode perakitan desain perpipaan (`src/plumb/`, `src/ui/plumbpanel.js`).
Simulasi arus dijeda dan panel berganti menjadi katalog.

- **Katalog uPVC** (abu, putih, bening; tanpa logam karena berkarat & beracun di air laut): pipa, knee 90°/45°,
  belokan 180°, knee reducer, knee drat dalam (faucet elbow), knee drat luar–dalam, tee, tee reducer, tee drat dalam,
  cross, sok, sok reducer, bushing, sok drat dalam/luar (female/male adapter), nipple hex, union, bulkhead, dop polos,
  dop drat, plug, ball valve, stop kran, flange, flange buta.
- **Ukuran**: seri Indonesia ½"–2" kelas AW/D dan metrik 20/25/32 mm; drat BSP. Tiap ujung punya jenis (sok polos,
  ujung polos, drat dalam, drat luar, flange) — hanya sambungan yang cocok ditawarkan (sok ↔ pipa, drat dalam ↔ luar,
  ukuran sama; reducer/bushing untuk ganti ukuran).
- **Merakit**: pilih titik awal (ada preset keluaran pompa / di atas bibir tank), lalu ketuk ujung hijau → pilih bagian
  → menempel otomatis dan ujung lanjutan langsung terpilih. Ketuk bagian untuk mengubah panjang potong, memutar per
  45°/90° di sumbu sambungan, mengganti ujung sambung (mis. tee lewat cabang), warna, menyisipkan sok/union/valve di
  tengah pipa (panjang total tetap), atau menghapus. Urungkan/ulangi, tank acuan bisa disembunyikan (layer kamera).
- **Daftar bahan**: jumlah fitting per ukuran & kelas, panjang potong tiap pipa (dikemas ke batang 3–6 m dengan FFD),
  sambungan lem/drat (seal tape)/flange, ujung yang masih terbuka, ukuran rakitan. Bisa disalin dan ikut masuk laporan
  Claude (bagian 13).
- **Simpan**: otomatis di browser, simpan dengan nama, ekspor/impor `.json` (divalidasi; bagian rusak dibuang).
- **Data dimensi**: terverifikasi — diameter luar metrik, panjang sok metrik ISO 727 (0,5·D + 6 mm), drat BSP ISO 7-1;
  perkiraan (beda antar merek) — diameter luar & tebal seri Indonesia, kedalaman sok tipe JIS, panjang badan fitting.

### Fase 2: templat, alat ukur, cek tabrakan (`src/plumb/templates.js`, `src/plumb/collide.js`)

- **Templat siap pakai** (kartu "Rangkaian baru"): U-pipe siphon ½"/¾" dengan posisi sama seperti siphon di simulasi
  (intake 8 cm, puncak 34 cm, ujung buang 22 cm, ball valve di kaki tank), dan return pompa ½"/¾" dari keluaran pompa
  ke sendi duckbill (rute selang return di simulasi) dengan union di atas pompa + ball valve di atas muka air filter.
  Seri metrik memakai 20/25 mm. Semua dirakit dari bagian katalog biasa, jadi bisa diubah.
- **Ukur jarak**: ketuk dua titik (ujung hijau, bagian = titik tengahnya, atau kaca/meja) → jarak lurus + Δx/Δy/Δz,
  garis putus-putus dan kaki sumbu merah/hijau/biru di 3D.
- **Cek tabrakan** otomatis tiap perubahan: bagian sebagai kapsul (pipa selebar diameter luar, fitting selebar badan
  sok) terhadap kaca tank & filter, sekat, badan pompa, protein skimmer, meja, lemari, dan bagian lain. Bagian yang
  menabrak diwarnai merah dan didaftar (ketuk untuk memilih). Bulkhead boleh menembus kaca; bagian yang bersebelahan di
  rakitan tidak dicek satu sama lain; toleransi 1 mm.

### Fase 3: hidrolik desain (`src/plumb/hydro.js`, `returnK` di `src/physics/hydraulics.js`)

- **Jalur**: dari ujung masuk (otomatis bila ada ujung terbuka ≤ 6 cm dari keluaran pompa, atau pilih manual) ke ujung
  keluar (bawaan: terdekat ke duckbill), menelusuri pohon rakitan. Ujung lain yang masih terbuka diperingatkan.
- **Rugi**: gesek pipa Darcy–Weisbach (f dari Re, Blasius untuk pipa halus); fitting metode Crane TP-410
  K = f_T·(L/D) dengan L/D knee 90° 30, knee 45° 16, belokan 180° 50, tee lurus 20, tee cabang 60, gate valve 8,
  ball valve 3 — f_T dari rumus turbulen penuh 1/√f = −2·log10(ε/3,7D), ε = 0,045 mm (±5% dari tabel Crane); reducer
  mendadak 0,5(1−β²) / (1−β²)²; sok, union, adapter, bulkhead = perkiraan. Ball valve pertama di jalur mengikuti slider
  bukaan ball valve return. Ujung keluar duckbill = energi kinetik jet di mulut 1,5 cm² (sama dengan jet CFD).
- **Titik kerja**: kurva pompa (H = Hmax·daya² − c·Q²) = beda statis + Σ rugi; dibandingkan dengan pipa return bawaan.
  Rincian per bagian (Ø, kecepatan, K, rugi), kecepatan tertinggi (peringatan di atas ±2,5 m/s), label kecepatan 3D.
- **Pakai sebagai pipa return di simulasi**: luas acuan, panjang inersia, K ekuivalen (tiap ruas di kecepatannya sendiri,
  diacu ke luas acuan) dan tinggi ujung keluar dipakai model pompa — termasuk aliran balik saat padam. Pilihan disimpan
  dan dipulihkan saat halaman dibuka; tanpa desain, model bawaan v1 tetap bit-identik (diuji). Ringkasan hidrolik ikut
  laporan Claude (bagian 13) dan kartu pompa.

## Analisis & laporan untuk Claude

Tab **Analisis** (`src/analysis/`, `src/ui/analysis.js`):

- **Profil biota**: ikan saja (FOWLR, bawaan), soft coral, LPS, SPS, atau campuran. Profil menentukan target arus
  (rata-rata tank, **arus di sekitar batu** = sel air yang menempel di batu, zona mati, arus dasar) dan salinitas.
- **Saran otomatis** (mesin aturan di browser, tanpa AI/internet, diperbarui ±1 dtk): keamanan (level saat padam,
  pelampung, siphon-break, pompa kering, ATO), kesetimbangan hidrolik (pelampung memutus pompa, gluk-gluk, surface
  skimmer, valve dicekik, sirkulasi), filter, arus & pertukaran air (umur air, efisiensi pertukaran, duckbill mengarah
  ke intake), salinitas. Tiap saran: nilai sekarang vs target, langkah penyetelan, tombol aksi sekali klik bila ada,
  rujukan [n], dan **tingkat bukti** A (riset peer-reviewed) / B (rumus teknik & model) / C (konsensus praktisi —
  ditandai, tidak disamarkan sebagai riset). Lencana di tab = jumlah temuan kritis + perlu perhatian.
- **Cari titik seimbang**: model hidrolik dijalankan di latar (dicicil per frame) untuk bukaan valve U-pipe 5–100%
  sampai tunak; dipilih bukaan paling tertutup yang stabil (siphon penuh, pelampung tidak memutus pompa, level ≤ 28,3 cm)
  **dan** tetap stabil bila debit pompa naik 20%. Bila siphon tidak sanggup sama sekali, dicari daya pompa maksimum.
- **Uji pulsa standar** (tracer, Danckwerts 1953): pulsa pewarna 20 dtk setelah arus berkembang; menghasilkan t95
  (tank homogen 95%, CoV ≤ 5%), waktu tiba & puncak di intake, rasio puncak terhadap campur sempurna (jalan pintas),
  dibandingkan dengan waktu tinggal τ.
- **Laporan untuk Claude Project**: Markdown lengkap (konfigurasi, hidrolik, arus CFD, pertukaran air, salinitas lokal,
  uji pulsa + kurva, titik seimbang, semua saran + rujukan, listrik, batasan model, pustaka, permintaan analisis) +
  lampiran JSON. Unduh `.md`, salin, atau bagikan (file) — plus **instruksi Project** siap tempel.
- **Pustaka**: 20 referensi; bibliografi & DOI dicek pada November 2026, referensi yang DOI-nya tidak bisa dipastikan
  dicantumkan tanpa DOI (`src/analysis/references.js`).

## Laporan masalah (diagnostik)

Tab **Tampilan → Laporan masalah** berisi ringkasan kesehatan (FPS, kualitas grafis, waktu per langkah CFD, seberapa
jauh CFD mengikuti waktu simulasi, jumlah error) dan tombol **Salin laporan** / **Bagikan…**. Laporan teks berisi versi
build (hash commit), perangkat & GPU, pengaturan, dan 40 kejadian terakhir (langkah pengguna, perubahan otomatis, error),
sehingga masalah di HP bisa dilaporkan tanpa screenshot. Bila ada error, lencana merah muncul di tampilan 3D; ketuk untuk
menyalin laporan. Semua dibuat di perangkat — tidak ada data yang dikirim otomatis (`src/diag.js`, `src/ui/diagnostics.js`).

Ketahanan: error di dalam langkah CFD ditangkap worker dan klien pulih otomatis (5 error berturut-turut → CFD dimatikan
dengan pemberitahuan), worker yang tidak menjawab 10 detik dimulai ulang, medan NaN dinolkan dan diulang, error di loop
render tidak lagi menghentikan animasi, dan modul build lama yang hilang setelah deploy baru memicu muat ulang sekali.

**Context WebGL hilang** (GPU HP kewalahan, biasanya karena kabut 3D): setelah pulih, peta pantulan (PMREM), bayangan
statis, partikel garis arus, dan tekstur kabut dibuat ulang (isi render target ikut hilang). Beban diturunkan bertahap:
1× → kualitas minimal Sedang + langkah kabut lebih kasar, 2× → Hemat (tanpa bayangan), 3× → kabut 3D dimatikan
sementara; tiap langkah diberi tahu dan tercatat (kualitas, resolusi, kabut, studi saat kejadian). Tingkatnya disimpan
lokal di perangkat dan turun satu tingkat per hari tanpa kejadian baru ("Kembalikan ke bawaan" menghapusnya). Di layar
sentuh beresolusi tinggi, langkah sinar kabut sejak awal satu tingkat lebih kasar.

## Pengaturan tersimpan

Semua pengaturan (parameter tank, tampilan, peta arus, kualitas grafis, tabel listrik) disimpan otomatis di
`localStorage` browser, per perangkat. Status listrik, jeda, dan grup menu yang terbuka sengaja tidak disimpan.
Tombol **Reset** hanya mengulang simulasi dengan pengaturan yang sedang dipakai; tombol **Kembalikan ke bawaan**
(di bawah panel kontrol) menghapus semua pengaturan tersimpan. Data tersimpan divalidasi ketat (`src/settings.js`),
sehingga data rusak/versi lama tidak membuat aplikasi error.

## Catatan model

- **Hidrolik**: persamaan momentum kolom air + rugi Darcy–Weisbach, kurva pompa parabolik + hukum afinitas,
  weir tajam dengan koreksi Villemonte. Numeriknya sengaja dipertahankan bit-per-bit sama dengan versi 1
  (diuji otomatis di `tests/hydraulics.test.js`). Integrasi kini memakai langkah tetap 0,02 dtk
  sehingga hasil tidak bergantung pada frame rate.
- **Susunan intake "2 U-pipe terpisah"** (tab Tank → Siphon U-pipe → Susunan intake; `skimmerPipe` di
  `src/physics/hydraulics.js`): pipa 0 hanya intake bawah, pipa 1 khusus surface skimmer (kepala apung dengan kedalaman
  bibir yang bisa diatur, atau mangkuk tetap). Pipa skimmer hanya dipasok lewat bibir (weir Villemonte) dan lubang
  cadangan opsional (lubang tajam, Cd 0,62, di 20 cm); level di dalam kepala skimmer dicari sehingga pasokan = tarikan
  siphon. Bila tarikan melebihi pasokan walau kepala skimmer kering, udara ikut tersedot ("siphon kelaparan"). Air
  permukaan selalu membawa gelembung mikro; gelembung hanya tersapu bila kecepatan > 0,35·√(g·D) (gelembung Taylor,
  Davies & Taylor 1950). Dop berlubang di ujung buang: rugi jet K = (1/(Cc·β²))² − 1. Aqualifter khusus U skimmer dan
  valve U skimmer opsional. Contoh (pipa TY 20 mm, kepala apung 4 mm, tanpa tambahan): siphon skimmer putus ±20 detik
  setelah dipancing; lubang cadangan 6–10 mm atau bibir 8 mm → stabil tanpa udara; dop 8 mm hanya stabil bila ada
  aqualifter. Diuji di `tests/hydraulics.test.js`; tanpa susunan ini model lama tetap bit-identik.
- **CFD tank**: kisi MAC staggered 32×20×16, adveksi MacCormack, viskositas eddy, tutup kaku di permukaan,
  proyeksi tekanan PCG/MIC(0). Divergensi sisa ±10⁻³ s⁻¹ (versi 1, kisi collocated + 16 iterasi Gauss–Seidel: ±13 s⁻¹).
- **CFD filter (3D)**: kisi MAC 49×30×10 @ 1 cm memakai solver yang sama (`src/cfd/mac3d.js`): sekat bercelah/weir,
  badan skimmer & pompa padat, kapas/bio berpori, level per chamber. Aliran di atas weir = sumur hulu + sumber & jet jatuh
  di hilir; sumber volume tiap komponen terhubung dijaga seimbang tepat (diuji).
- **Visualisasi arus** (tombol *Peta arus*): bidang potong tank (mendatar/tegak) dan filter berisi peta warna laju arus
  (Turbo/Plasma/Viridis, sesaat atau rata-rata 8 dtk) + garis arus beranimasi. Garis arus dihitung di GPU
  (ribuan partikel di tekstur, jejak memudar ping-pong) sehingga ringan; lihat `src/render/flowviz.js`.
- **Kabut kecepatan 3D**: volume rendering (ray marching tekstur 3D 32×20×16) medan laju seluruh tank, dengan sorotan
  arus kuat, zona mati (< 1 cm/s, warna peringatan), atau semua laju. Sinar berhenti di batu/pasir sehingga oklusi benar
  tanpa depth pass; langkah sinar menyesuaikan kualitas grafis. Lihat `src/render/flowfog.js`.
- **Transport skalar (air baru, umur air, salinitas lokal)**: tiga besaran dibawa oleh medan arus CFD dengan volume
  hingga konservatif (fluks muka MAC, rekonstruksi TVD van Leer, difusivitas turbulen ν_t/Sc_t + difusi molekuler,
  sub-langkah CFL) di tank dan filter yang tersambung jadi satu loop tertutup: yang tersedot intake siphon masuk filter,
  yang dihisap pompa keluar dari duckbill.
  - *Air baru (pewarna)*: penanda pasif dari duckbill (denyut 20 dtk atau terus-menerus); kekekalan diuji < 1%.
    Skala warnanya otomatis (batas atas = persentil 98, minimal 10%): pulsa 20 dtk hanya ±1,8 L air bertanda yang
    setelah tercampur tinggal ±5%, sehingga dengan skala tetap 0–100% awannya tampak tidak bergerak/hilang.
  - *Umur air*: umur rata-rata lokal sejak keluar duckbill (0 di duckbill, +1 dtk/dtk). Dari sini dihitung waktu tinggal
    nominal τ = V/Q, efisiensi pertukaran udara/air ACE = τ/(2·⟨umur⟩) (50% = campur sempurna; < 50% = jalan pintas/ruang
    mati) dan fraksi "air tua" (umur > 2τ). Ini ukuran ruang mati yang lebih tepat daripada laju arus semata.
  - *Salinitas lokal*: air tawar ATO masuk sebagai sumber 0 ppt di chamber pompa; gaya apung Boussinesq
    (β_S = 7,6·10⁻⁴ /ppt) membuat air lebih tawar cenderung naik. Karena permukaan dimodelkan sebagai tutup kaku,
    salinitas rata-rata dikunci ke neraca garam model hidrolik; sebaran lokal tetap dari transport.
  - Penanda putih skematis lama (lintasan gambar tangan dari duckbill ke intake) dihapus; semua visual aliran di tank
    dan filter kini berasal dari CFD.
  - Batasan: isotermal (tanpa stratifikasi suhu), penguapan tidak dimodelkan sebagai aliran (studi ATO menurunkan level
    chamber pompa secara manual), kisi kasar (1–1,5 cm) sehingga lapisan batas tidak teresolusi, dan pada perangkat lambat
    waktu CFD bisa tertinggal dari waktu hidrolik.
- **Kaca**: tanpa garis rangka di tepi. Warna kaca mengikuti panjang lintasan cahaya di dalam kaca (bening bila dilihat
  tegak lurus, menghijau bila dilihat miring), pantulan ditambahkan utuh dari lingkungan pantulan khusus kaca
  (jendela berkisi; dipisah supaya pencahayaan benda lain tidak berubah), tepi atas dipoles membulat dan berpendar
  hijau, muka potong di sudut dan alas. Lihat `src/render/materials.js` dan `src/render/scene/tank.js`.
- **Gaya 3D realistis** (`src/render/realism.js`, tekstur prosedural tanpa unduhan):
  - batu hidup berpori (bump + lubang) berwarna krem hangat × koralin; pasir berbutir; riak halus berkilau di permukaan
    air; air makin biru ke dasar dan sedikit lebih jernih; kaustik di dasar & batu 1,5× lebih kuat;
  - berkas cahaya dari lampu LED ke dalam air (warna mengikuti lampu, lebih jelas di mode gelap);
  - bayangan halus (ambient occlusion, GTAO three.js, resolusi setengah) ditumpangkan di atas render biasa — bukan lewat
    EffectComposer, karena komposer mencampur air & kaca transparan di ruang warna linear sehingga tampak pucat. Label,
    partikel arus, bidang/kabut arus, sorotan, dan panah digambar sesudah AO supaya tidak ikut gelap;
  - beban bertingkat: AO hanya di kualitas **Tinggi** (di HP layar padat hanya bila Tinggi dipilih sendiri, bukan
    Otomatis), berkas cahaya mati di **Hemat**; turun otomatis bila FPS rendah atau context WebGL pernah hilang.
    Status AO & berkas cahaya tercantum di laporan diagnostik.
- **Gaya tampilan Clay** (tab **Tampilan → Gaya tampilan**; bawaan tetap Realistis, pilihan tersimpan):
  - panel claymorphism (`body.clay` di `src/styles.css`): kartu & tombol empuk berbayang lembut, kotak metrik dan
    select "tertekan", tab aktif biru menggembung, slider dengan bola dan bagian terisi (`--p`, `src/ui/claystyle.js`),
    palet pastel laut, varian mode gelap sistem;
  - 3D tanah liat (`createClayStyler` di `src/render/realism.js`): material matte pastel (batu koral, pasir krem,
    perabot peach, karang & ikan pastel) dengan tekstur "bekas jari" halus, air jernih, cahaya lebih lembut, tone
    mapping Neutral, AO lebih kuat, berkas cahaya mati. Material asli disimpan dan dipulihkan saat kembali ke
    Realistis — tanpa memuat ulang halaman.
- Angka adalah acuan untuk dikalibrasi saat uji air tawar, bukan pengganti uji itu.
