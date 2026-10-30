#!/usr/bin/env node
/**
 * BotForge build pipeline.
 *
 *  1. regenerates the frontend bot catalog from the template registry
 *  2. bundles the control plane (Node.js) and the Cloudflare Worker
 *  3. copies the static frontend into dist/frontend
 *  4. fails the build when banned placeholders or emoji leak into shipped assets
 */
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');

const NODE_EXTERNALS = [
  'fastify',
  '@fastify/cors',
  '@fastify/helmet',
  '@fastify/rate-limit',
  '@fastify/static',
  'pg',
  'zod',
  'node:*'
];

const BANNED_PATTERNS = [
  { pattern: /\bTODO\b/, label: 'TODO' },
  { pattern: /\bFIXME\b/, label: 'FIXME' },
  { pattern: /not implemented/i, label: 'not implemented' },
  { pattern: /Coming soon/i, label: 'Coming soon' }
];

const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{FE0F}]/u;

async function walk(directory, extensions) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.git', '.data'].includes(entry.name)) continue;
      files.push(...(await walk(full, extensions)));
      continue;
    }
    if (extensions.includes(extname(entry.name))) files.push(full);
  }
  return files;
}

async function guardSources() {
  const files = await walk(root, ['.ts', '.mjs']);
  const problems = [];
  for (const file of files) {
    if (file === fileURLToPath(import.meta.url)) continue;
    const content = await readFile(file, 'utf8');
    for (const rule of BANNED_PATTERNS) {
      if (rule.pattern.test(content)) problems.push(`${relative(root, file)} → ${rule.label}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Banned placeholders found:\n${problems.join('\n')}`);
  }
  return files.length;
}

async function guardFrontend() {
  const files = await walk(join(root, 'apps/frontend'), ['.html', '.css', '.js', '.svg']);
  const problems = [];
  for (const file of files) {
    if (file.endsWith('catalog.js')) continue;
    const content = await readFile(file, 'utf8');
    const match = content.match(EMOJI_PATTERN);
    if (match) problems.push(`${relative(root, file)} → ${match[0]}`);
  }
  if (problems.length > 0) {
    throw new Error(`Emoji found in frontend assets:\n${problems.join('\n')}`);
  }
  return files.length;
}

async function generateCatalog() {
  const { stdout } = await import('node:child_process').then(({ execFile }) =>
    new Promise((resolve, reject) => {
      execFile(process.execPath, ['--import', 'tsx', 'scripts/generate-catalog.mjs'], { cwd: root }, (error, stdout, stderr) => {
        if (error) reject(new Error(`${error.message}\n${stderr}`));
        else resolve({ stdout });
      });
    })
  );
  process.stdout.write(String(stdout));
}

async function bundle() {
  const shared = {
    bundle: true,
    format: 'esm',
    target: 'node20',
    sourcemap: false,
    logLevel: 'info',
    define: { 'process.env.NODE_ENV': '"production"' }
  };

  await esbuild({
    ...shared,
    entryPoints: [join(root, 'apps/control-plane/src/main.ts')],
    outfile: join(dist, 'control-plane/main.js'),
    platform: 'node',
    external: NODE_EXTERNALS,
    banner: { js: '#!/usr/bin/env node' }
  });

  await esbuild({
    ...shared,
    entryPoints: [join(root, 'apps/cloudflare-worker/src/index.ts')],
    outfile: join(dist, 'cloudflare-worker/index.js'),
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['workerd', 'worker', 'browser'],
    external: ['node:*', 'pg']
  });
}

async function copyFrontend() {
  await rm(join(dist, 'frontend'), { recursive: true, force: true });
  await cp(join(root, 'apps/frontend'), join(dist, 'frontend'), { recursive: true });
  const catalog = await stat(join(dist, 'frontend/assets/js/catalog.js'));
  if (catalog.size < 1000) throw new Error('generated catalog is suspiciously small');
}

async function writeBuildInfo() {
  const info = {
    name: 'botforge',
    version: '1.0.0',
    builtAt: new Date().toISOString(),
    node: process.version,
    entries: {
      controlPlane: 'dist/control-plane/main.js',
      cloudflareWorker: 'dist/cloudflare-worker/index.js',
      frontend: 'dist/frontend'
    }
  };
  await writeFile(join(dist, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`, 'utf8');
}

async function main() {
  await mkdir(dist, { recursive: true });
  const guarded = await guardSources();
  console.log(`source guard: ${guarded} files checked`);
  const frontendFiles = await guardFrontend();
  console.log(`frontend guard: ${frontendFiles} files checked, no emoji`);
  await generateCatalog();
  await bundle();
  await copyFrontend();
  await writeBuildInfo();
  console.log('build complete → dist/');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
