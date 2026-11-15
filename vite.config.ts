import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'), base: './',
  build: { outDir: resolve(__dirname, 'dist/renderer'), emptyOutDir: true, target: 'es2022',
    rolldownOptions: { input: process.env['SSHOS_PRODUCTION_BUILD']==='1' ? {main:resolve(__dirname,'src/renderer/index.html')}:{ main: resolve(__dirname, 'src/renderer/index.html'), xterm: resolve(__dirname, 'src/renderer/tests/xterm.html') } } }
});
