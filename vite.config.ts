import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 單一 HTML 打包：JS、CSS、Web Worker 全部內嵌，可雙擊開啟、離線使用
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  worker: { format: 'iife' },
  build: { target: 'es2020', assetsInlineLimit: 100000000, chunkSizeWarningLimit: 5000 },
});
