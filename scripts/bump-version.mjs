#!/usr/bin/env node
/**
 * Bumps the app version atomically across the 2 files that have to stay in
 * sync for PWA auto-update to work:
 *
 *   1. version.json — fetched by checkForAppUpdate() to know the server version
 *   2. <meta name="app-version"> inside index.html — the version the user's
 *      CURRENTLY-LOADED HTML reports. If iOS PWA serves a stale HTML, this
 *      meta tag will be old, while version.json will be fresh → mismatch
 *      detected → auto-reload kicks in.
 *
 * If these two go out of sync (bumping one without the other), PWA users
 * see either:
 *   - constant unnecessary reloads (meta stale, json fresh)
 *   - no updates ever (meta updated, json stale)
 *
 * Usage:
 *   node scripts/bump-version.mjs                    # auto-stamp YYYYMMDD-HHMM-deploy
 *   node scripts/bump-version.mjs "my-label-here"    # custom label appended
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const versionJsonPath = resolve(ROOT, 'version.json');
const indexHtmlPath   = resolve(ROOT, 'index.html');

// Build a version string. Defaults to YYYYMMDD-HHMM-deploy. Adding a custom
// label is allowed but optional.
function nowStamp() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const M = String(d.getUTCMonth() + 1).padStart(2, '0');
  const D = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${y}${M}${D}-${h}${m}`;
}

const customLabel = process.argv[2];
const version = customLabel
  ? `${nowStamp()}-${customLabel.replace(/[^a-z0-9\-]/gi, '-').toLowerCase()}`
  : `${nowStamp()}-deploy`;

// 1) version.json
writeFileSync(versionJsonPath, JSON.stringify({ v: version }) + '\n', 'utf8');
console.log(`✓ version.json → ${version}`);

// 2) meta tag in index.html
const html = readFileSync(indexHtmlPath, 'utf8');
const META_RE = /<meta\s+name="app-version"\s+content="[^"]*"\s*\/?>/i;
if (!META_RE.test(html)) {
  console.error('✗ <meta name="app-version"> not found in index.html');
  process.exit(1);
}
const newHtml = html.replace(META_RE, `<meta name="app-version" content="${version}">`);
writeFileSync(indexHtmlPath, newHtml, 'utf8');
console.log(`✓ <meta app-version> → ${version}`);

console.log('\nDone. Commit + push to deploy.');
