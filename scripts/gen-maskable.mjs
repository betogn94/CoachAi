// Genera íconos maskable a partir de icon-512.png: escala el logo a ~78% y lo
// centra sobre el fondo oscuro full-bleed (zona segura para el recorte de Android).
import sharp from 'sharp';

const SRC = 'icon-512.png';

// 512 maskable: escalo el logo a 450 (≈78% del frame) y extiendo el borde del
// original hacia afuera (extendWith:'copy') → el degradado continúa suave, sin
// costura, y el fondo queda full-bleed para el recorte de Android.
await sharp(SRC)
  .resize(450, 450)
  .extend({ top: 31, bottom: 31, left: 31, right: 31, extendWith: 'copy' })
  .png()
  .toFile('icon-512-maskable.png');

// 192 maskable (downscale del 512 maskable).
await sharp('icon-512-maskable.png').resize(192, 192).png().toFile('icon-192-maskable.png');

console.log('✓ icon-512-maskable.png + icon-192-maskable.png generados');
