#!/usr/bin/env node
/**
 * Minimal static server for the BotForge frontend with production-like headers.
 * Usage: node scripts/serve-frontend.mjs [--port 4173] [--host 0.0.0.0]
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(dirname(fileURLToPath(import.meta.url))), 'apps/frontend');

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return fallback;
}

const port = Number(argValue('port', process.env.PORT || 4173));
const host = argValue('host', process.env.HOST || '0.0.0.0');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const target = normalize(join(root, pathname));
    if (!target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      response.end('Forbidden');
      return;
    }

    let info;
    try {
      info = await stat(target);
    } catch {
      info = null;
    }

    if (!info || !info.isFile()) {
      const notFound = join(root, '404.html');
      const fallbackInfo = await stat(notFound).catch(() => null);
      if (fallbackInfo) {
        response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
        createReadStream(notFound).pipe(response);
        return;
      }
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      response.end('Not found');
      return;
    }

    const extension = extname(target).toLowerCase();
    response.writeHead(200, {
      'Content-Type': MIME[extension] ?? 'application/octet-stream',
      'Content-Length': String(info.size),
      'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=3600',
      ...SECURITY_HEADERS
    });
    createReadStream(target).pipe(response);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`Internal error: ${error instanceof Error ? error.message : 'unknown'}`);
  }
});

server.listen(port, host, () => {
  console.log(`BotForge frontend → http://${host}:${port}`);
});
