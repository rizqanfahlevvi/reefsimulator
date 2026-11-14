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
- Angka adalah acuan untuk dikalibrasi saat uji air tawar, bukan pengganti uji itu.
