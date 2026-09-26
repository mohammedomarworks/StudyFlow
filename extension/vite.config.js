import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

export default defineConfig({
  base: '',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'src/sidepanel/sidepanel.html'),
        'service-worker': resolve(__dirname, 'src/background/service-worker.js')
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'service-worker') {
            return 'src/background/service-worker.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  },
  plugins: [
    {
      name: 'copy-extension-manifest-and-assets',
      closeBundle() {
        // Copy manifest.json to dist
        fs.copyFileSync(
          resolve(__dirname, 'manifest.json'),
          resolve(__dirname, 'dist/manifest.json')
        );

        // Copy icons to dist/src/assets/icons
        const iconDestDir = resolve(__dirname, 'dist/src/assets/icons');
        fs.mkdirSync(iconDestDir, { recursive: true });
        const iconSrcDir = resolve(__dirname, 'src/assets/icons');
        for (const file of fs.readdirSync(iconSrcDir)) {
          if (file.endsWith('.png')) {
            fs.copyFileSync(
              resolve(iconSrcDir, file),
              resolve(iconDestDir, file)
            );
          }
        }
      }
    }
  ]
});
