import { defineConfig } from 'vite';

export default defineConfig({
  // path relatif supaya build bisa dibuka dari sub-folder (mis. GitHub Pages /reefsimulator/)
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // uji fisika CFD menjalankan ratusan langkah solver
    testTimeout: 60000,
  },
});
