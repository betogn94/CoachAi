// Generates KING (Jesús whitelabel) PWA icons from tenants/jesus/icon.png.
//
// Same idea as scripts/generate-icons.js but with the KING aesthetic:
// the source kettlebell-AI is already coral on transparent, so we sit it
// on a CREAM background with a subtle rose radial accent — matches the
// app's KING palette (--bg #FDF7F8, --surface2 #FFF0F4). The light bg
// also makes the icon read distinctly from the default CoachAI dark one
// next to it on a user's home screen.
//
// iOS needs the icon to be square + opaque (no transparency) or it
// composites the transparent area as white and the rounded-corner mask
// gets lost. We composite the coral icon over the cream bg → fully
// opaque PNG.
//
// Run once when the source icon changes, OR re-run if you tweak the bg:
//   node scripts/generate-icons-jesus.js
//
// Outputs (overwritten on every run):
//   tenants/jesus/icon-180.png   — iOS apple-touch-icon
//   tenants/jesus/icon-192.png   — PWA manifest standard
//   tenants/jesus/icon-512.png   — PWA manifest large

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'tenants', 'jesus', 'icon.png');
const OUT_DIR = path.join(ROOT, 'tenants', 'jesus');

// Background: KING cream with a soft rose radial off the top-left corner.
// The radial mimics the brand's "light, soft, generous" Airbnb-like
// language. Stops chosen so the lightest point reads near the cream --bg
// and the darkest is roughly --surface2 (#FFF0F4) — never reaches the
// vivid coral so the icon's coral lines stay the dominant brand cue.
const bgSvg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="g" cx="30%" cy="20%" r="85%">
      <stop offset="0%" stop-color="#FFE7EE"/>
      <stop offset="55%" stop-color="#FFF0F4"/>
      <stop offset="100%" stop-color="#FDF7F8"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="0" ry="0" fill="url(#g)"/>
</svg>`;

async function generate(outName, size) {
  // 1. Build the cream-rosa background
  const bg = await sharp(Buffer.from(bgSvg(size))).png().toBuffer();

  // 2. Resize the source icon to ~68% of the canvas (matches the default
  //    generator's padding ratio so KING + default sit consistent on
  //    the home screen).
  const logoSize = Math.round(size * 0.68);
  const logo = await sharp(SRC)
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  // 3. Composite icon centered on background → opaque PNG (iOS-safe)
  const offset = Math.round((size - logoSize) / 2);
  const outPath = path.join(OUT_DIR, outName);
  await sharp(bg)
    .composite([{ input: logo, top: offset, left: offset }])
    .png()
    .toFile(outPath);

  const stat = fs.statSync(outPath);
  console.log(`  ✓ tenants/jesus/${outName} (${size}×${size}, ${(stat.size/1024).toFixed(1)} KB)`);
}

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error(`Source not found: ${SRC}`);
    console.error('Make sure tenants/jesus/icon.png exists (the recolored coral kettlebell-AI).');
    process.exit(1);
  }
  console.log('Generating KING PWA icons from tenants/jesus/icon.png...');
  await generate('icon-180.png', 180);   // iOS apple-touch-icon
  await generate('icon-192.png', 192);   // PWA manifest standard
  await generate('icon-512.png', 512);   // PWA manifest large
  console.log('Done.');
})();
