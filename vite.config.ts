import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig, Plugin } from 'vite';

function aistudioMediaPlugin(): Plugin {
  return {
    name: 'vite-plugin-aistudio-media',

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/assets/aistudio/')) {
          const rawPath = req.url.split('?')[0].split('#')[0];

          try {
            const decodedPath = decodeURIComponent(rawPath);
            const relativePath = decodedPath.replace(/^\/+/, '');

            const aistudioDir = path.resolve(
              process.cwd(),
              'public',
              'assets',
              'aistudio'
            );

            const filePath = path.resolve(
              process.cwd(),
              'public',
              relativePath
            );

            if (
              filePath.startsWith(aistudioDir + path.sep) &&
              fs.existsSync(filePath) &&
              fs.statSync(filePath).isFile()
            ) {
              const ext = path.extname(filePath).toLowerCase();

              const mimeMap: Record<string, string> = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.svg': 'image/svg+xml',
                '.bmp': 'image/bmp',
                '.ico': 'image/x-icon',
                '.mp4': 'video/mp4',
                '.webm': 'video/webm',
                '.ogv': 'video/ogg',
                '.mp3': 'audio/mpeg',
                '.wav': 'audio/wav',
                '.ogg': 'audio/ogg',
                '.pdf': 'application/pdf',
              };

              res.setHeader(
                'Content-Type',
                mimeMap[ext] || 'application/octet-stream'
              );

              res.setHeader('Cache-Control', 'no-cache');

              fs.createReadStream(filePath).pipe(res);
              return;
            }
          } catch {
            // Continue to Vite.
          }
        }

        next();
      });
    },
  };
}

export default defineConfig(({ command }) => {
  const isDev = command === 'serve';

  const certPath = path.resolve(
    process.cwd(),
    'certs',
    '192.168.29.228+2.pem'
  );

  const keyPath = path.resolve(
    process.cwd(),
    'certs',
    '192.168.29.228+2-key.pem'
  );

  const hasLocalCertificates =
    fs.existsSync(certPath) && fs.existsSync(keyPath);

  return {
    // GitHub Pages project URL:
    // https://webtester976.github.io/workmonitor/
    base: '/workmonitor/',

    plugins: [
      react(),
      tailwindcss(),
      aistudioMediaPlugin(),
    ],

    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), '.'),
      },
    },

    server: {
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,

      // HTTPS is only used for local development.
      ...(isDev && hasLocalCertificates
        ? {
            https: {
              cert: fs.readFileSync(certPath),
              key: fs.readFileSync(keyPath),
            },
          }
        : {}),

      hmr: process.env.DISABLE_HMR !== 'true',

      watch:
        process.env.DISABLE_HMR === 'true'
          ? null
          : {},
    },
  };
});