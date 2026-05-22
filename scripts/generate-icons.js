// Generates PWA icons (apple-touch-icon + manifest icons) from logo-icon.png.
//
// iOS doesn't apply rounded corners to icons with transparency, and renders
// the transparent areas as white — which makes our gradient-outline logo
// nearly invisible on the home screen. This script composites the logo over
// a solid brand-dark background so the icon is always visible regardless of
// device or theme.
//
// Run once whenever the source logo changes:
//   node scripts/generate-icons.js

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'logo-icon.png');

// Background: brand-dark navy with a subtle violet→teal radial accent so the
// icon doesn't look flat. Encoded as an inline SVG so sharp can rasterize it.
const bgSvg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="g" cx="30%" cy="20%" r="80%">
      <stop offset="0%" stop-color="#1a1735"/>
      <stop offset="55%" stop-color="#0e0e22"/>
      <stop offset="100%" stop-color="#070714"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="0" ry="0" fill="url(#g)"/>
</svg>`;

async function generate(outName, size) {
  // 1. Build the dark background
  const bg = await sharp(Buffer.from(bgSvg(size))).png().toBuffer();

  // 2. Resize the source logo to ~68% of the canvas (~16% padding each side)
  const logoSize = Math.round(size * 0.68);
  const logo = await sharp(SRC)
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  // 3. Composite logo centered on background
  const offset = Math.round((size - logoSize) / 2);
  const outPath = path.join(ROOT, outName);
  await sharp(bg)
    .composite([{ input: logo, top: offset, left: offset }])
    .png()
    .toFile(outPath);

  const stat = fs.statSync(outPath);
  console.log(`  ✓ ${outName} (${size}×${size}, ${(stat.size/1024).toFixed(1)} KB)`);
}

(async () => {
  console.log('Generating PWA icons from logo-icon.png...');
  await generate('apple-touch-icon.png', 180);   // iOS A2HS
  await generate('icon-192.png', 192);           // PWA manifest standard
  await generate('icon-512.png', 512);           // PWA manifest large
  // Also overwrite logo-icon.png at 512 so older references still get the new look
  // (commented out by default — uncomment if you want to overwrite the source)
  // await generate('logo-icon.png', 512);
  console.log('Done.');
})();
