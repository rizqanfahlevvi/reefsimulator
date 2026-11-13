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
  layout.js             posisi batu, duckbill, wavemaker, pipa (dipakai render dan CFD)
  physics/
    constants.js        konstanta & geometri tank (CGS)
    hydraulics.js       model hidrolik (identik numerik dengan versi 1)
  cfd/
    engine.js           Navier–Stokes: tank 3D (MAC) + filter 2D (MAC)
    poisson.js          solver tekanan PCG + MIC(0)
    flow.worker.js      Web Worker
    client.js           penyusun pesan + sampling medan untuk jejak partikel
  render/
    context.js          renderer, kamera, lampu, environment
    materials.js        material (kaca "glassy", kaustik)
    geom.js             helper geometri + StaticBatch (penggabung draw call)
    world.js            perakit scene + update per frame + kualitas
    scene/*.js          ruangan, tank, aquascape, ikan, peralatan, air, siphon, partikel, jejak, label
  ui/                   kontrol, metrik/status, grafik, listrik
tests/                  Vitest: regresi hidrolik vs versi 1, solver Poisson, engine CFD
```

## Catatan model

- **Hidrolik**: persamaan momentum kolom air + rugi Darcy–Weisbach, kurva pompa parabolik + hukum afinitas,
  weir tajam dengan koreksi Villemonte. Numeriknya sengaja dipertahankan bit-per-bit sama dengan versi 1
  (diuji otomatis di `tests/hydraulics.test.js`). Integrasi kini memakai langkah tetap 0,02 dtk
  sehingga hasil tidak bergantung pada frame rate.
- **CFD tank**: kisi MAC staggered 32×20×16, adveksi MacCormack, viskositas eddy, tutup kaku di permukaan,
  proyeksi tekanan PCG/MIC(0). Divergensi sisa ±10⁻³ s⁻¹ (versi 1, kisi collocated + 16 iterasi Gauss–Seidel: ±13 s⁻¹).
- **CFD filter**: kisi MAC 2D 98×60, kapas/bio sebagai hambatan berpori.
- Angka adalah acuan untuk dikalibrasi saat uji air tawar, bukan pengganti uji itu.
