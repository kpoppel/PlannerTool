import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import fs from 'fs';
import sirv from 'sirv';

export function createDevServerConfig(env = process.env) {
  const instance = env.PLANNER_AUTH_INSTANCE;
  if (instance === undefined) return {};
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(instance)) {
    throw new Error('Invalid development broker instance');
  }
  const publicUrl = new URL(env.PLANNER_AUTH_PUBLIC_URL);
  const brokerUrl = new URL(env.PLANNER_AUTH_URL);
  if (publicUrl.pathname !== '/auth/' || brokerUrl.pathname !== '/auth/') {
    throw new Error('Development broker URLs must end in /auth/');
  }
  if (env.PLANNER_AUTH_UPSTREAM_MODE === 'entra' && publicUrl.protocol !== 'https:') {
    throw new Error('Live Entra development requires HTTPS');
  }
  if (publicUrl.hostname !== 'localhost' || !publicUrl.port) {
    throw new Error('Development browser ingress requires localhost with an explicit port');
  }
  const prefix = '/' + instance;
  const backendPort = env.PLANNER_DEV_BACKEND_PORT === undefined ? 8001 : Number(env.PLANNER_DEV_BACKEND_PORT);
  if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535) {
    throw new Error('Invalid development backend port');
  }
  const backend = {
    target: 'http://localhost:' + backendPort,
    changeOrigin: false,
    xfwd: true,
    rewrite: path => path.slice(prefix.length),
  };
  const server = {
    host: 'localhost',
    port: Number(publicUrl.port),
    strictPort: true,
    proxy: {
      [prefix + '/api']: backend,
      [prefix + '/admin/v1']: backend,
      [prefix + '/admin/check']: backend,
      '/auth': { target: brokerUrl.origin, changeOrigin: false, xfwd: true },
    },
  };
  if (publicUrl.protocol === 'https:') {
    if (!env.PLANNER_DEV_TLS_CERT_FILE || !env.PLANNER_DEV_TLS_KEY_FILE) {
      throw new Error('HTTPS development requires PLANNER_DEV_TLS_CERT_FILE and PLANNER_DEV_TLS_KEY_FILE');
    }
    server.https = {
      cert: fs.readFileSync(env.PLANNER_DEV_TLS_CERT_FILE),
      key: fs.readFileSync(env.PLANNER_DEV_TLS_KEY_FILE),
    };
  }
  return { base: prefix + '/', server };
}

function adminLoginEntryPlugin() {
  const prefix = process.env.PLANNER_AUTH_INSTANCE === undefined ? '' : '/' + process.env.PLANNER_AUTH_INSTANCE;
  return {
    name: 'admin-login-entry',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname === prefix + '/admin/login') {
          request.url = url.pathname + '.html' + url.search;
        }
        next();
      });
    },
  };
}

// Helper plugin: copy selected assets from `www/` into `dist/` after build
const copySelectedAssetsPlugin = (files = []) => {
  // Copy files or directories from www/ into dist/ after build completes.
  const copyDirRecursive = (srcDir, destDir) => {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    for (const name of fs.readdirSync(srcDir)) {
      const srcPath = resolve(srcDir, name);
      const destPath = resolve(destDir, name);
      const stat = fs.statSync(srcPath);
      if (stat.isDirectory()) {
        copyDirRecursive(srcPath, destPath);
      } else {
        const destParent = dirname(destPath);
        if (!fs.existsSync(destParent)) fs.mkdirSync(destParent, { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      }
    }
  };

  return {
    name: 'copy-selected-assets',
    closeBundle() {
      try {
        const root = resolve(__dirname, 'www');
        const out = resolve(__dirname, 'dist');
        for (const f of files) {
          const src = resolve(root, f.replace(/^\/?/, ''));
          const dest = resolve(out, f.replace(/^\/?/, ''));
          if (!fs.existsSync(src)) {
            // skip missing
            continue;
          }
          const stat = fs.statSync(src);
          if (stat.isDirectory()) {
            copyDirRecursive(src, dest);
          } else {
            const destDir = dirname(dest);
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
            fs.copyFileSync(src, dest);
          }
        }
      } catch (e) {
        console.warn('copy-selected-assets: failed to copy assets', e);
      }
    },
  };
};

// Plugin: help resolve relative imports that reference the repo's `www/js` files
function resolveWwwJsPlugin(rootDir) {
  return {
    name: 'resolve-www-js-relative',
    resolveId(source, importer) {
      if (!importer || !source) return null;
      // normalize file:// importers (Vitest provides file URLs)
      let importerPath = importer;
      try {
        if (importerPath.startsWith('file://'))
          importerPath = new URL(importerPath).pathname;
        // Vitest/Vite may provide importer ids like '/@fs/...' — strip the /@fs prefix
        if (importerPath.startsWith('/@fs/'))
          importerPath = importerPath.replace(/^\/@fs/, '');
      } catch (e) {
        /* fallthrough, use original importer */
      }
      // quickly check for mentions of www/js in the import path
      if (!source.includes('www/js')) return null;
      try {
        // try resolving relative to the importer
        const baseCandidate = resolve(dirname(importerPath), source);
        const trySuffixes = ['', '.js', '.mjs', '.ts', '/index.js', '/index.mjs'];
        for (const sfx of trySuffixes) {
          const cand = baseCandidate + sfx;
          if (fs.existsSync(cand)) return cand;
        }
        // try resolving from project root (strip any leading ./)
        const rootCandidateBase = resolve(rootDir, source.replace(/^\.\/?/, ''));
        for (const sfx of trySuffixes) {
          const cand = rootCandidateBase + sfx;
          if (fs.existsSync(cand)) return cand;
        }
      } catch (e) {
        // fallthrough
      }
      return null;
    },
  };
}

export default defineConfig({
  // Use the `www` folder as the Vite root so index.html under `www/` is
  // used as the build entry. Keep project root available to plugins by
  // passing it into helpers where needed.
  root: resolve(__dirname, 'www'),
  resolve: {
    // Use an array form to allow regex-based aliasing for absolute imports like
    // '/static/js/...' so Vite's import-analysis can resolve them to local files.
    alias: [
      { find: '@esm-bundle/chai', replacement: 'chai' },
      { find: 'www', replacement: resolve(__dirname, 'www') },
      { find: 'www/js', replacement: resolve(__dirname, 'www/js') },
      { find: '/static', replacement: resolve(__dirname, 'www') },
      { find: '/admin/static', replacement: resolve(__dirname, 'www/admin') },
      // Regex to map absolute /static/js/<path> imports to the local www/js/<path>
      {
        find: /^\/static\/js\/(.*)/,
        replacement: resolve(__dirname, 'www/js') + '/$1',
      },
      {
        find: /^\/admin\/static\/js\/(.*)/,
        replacement: resolve(__dirname, 'www/admin/js') + '/$1',
      },
      // Specific vendor alias as fallback
      {
        find: '/static/js/vendor/lit.js',
        replacement: resolve(__dirname, 'www/js/vendor/lit.js'),
      },
    ],
  },
  plugins: [
    adminLoginEntryPlugin(),
    resolveWwwJsPlugin(resolve(__dirname)),
    // Copy timeline image and the docs directory into dist for production
    copySelectedAssetsPlugin(['/timeline-line.svg', 'docs', '/js', '/css']),
  ],
  // Disable the default publicDir copy (we'll copy only selected files)
  publicDir: false,
  // Build settings: enable manifest and content-hashed filenames so the
  // server can perform cache-busting by resolving logical asset names to
  // their hashed outputs. Use `/static/` as the base so built assets can
  // be served from the existing `/static/` path.
  base: './',
  build: {
    manifest: true,
    // Write build output to top-level `dist` directory (absolute path)
    outDir: resolve(__dirname, 'dist'),
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'www/index.html'),
        'admin/index': resolve(__dirname, 'www/admin/index.html'),
        'admin/login': resolve(__dirname, 'www/admin/login.html'),
      },
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/chunks/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
      },
    },
  },
  // Dev server with API proxying to Python backend; Vite serves www/ including www/admin/ pages
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: false,
      },
      '/admin/v1': {
        target: 'http://localhost:8001',
        changeOrigin: false,
      },
      '/admin/check': {
        target: 'http://localhost:8001',
        changeOrigin: false,
      },
    },
  },
  ...createDevServerConfig(),
});
