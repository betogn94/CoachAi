// ============================================================================
// SUBIR FOTOS DE INICIO — carga manual de las fotos "punto de inicio" de una
// clienta al bucket privado progress-photos + crea las filas en fotos_progreso.
// Replica EXACTAMENTE lo que hace la app (uploadFoto en index.html): misma ruta,
// mismo formato de url_foto, tipo='inicio', vista='frente'/'espalda'.
//
// USO (desde la carpeta del repo):
//   $env:SUPABASE_SERVICE_KEY="TU_SERVICE_ROLE_KEY"
//   node scripts/subir-fotos-inicio.mjs "<ruta-FRENTE>" "<ruta-ESPALDA>"
//
// La service_role key la sacás de: Supabase → Settings → API → "service_role".
// Queda SOLO en tu terminal — no se guarda en ningún lado.
// ============================================================================
import fs from 'node:fs';
import sharp from 'sharp';

const SUPABASE_URL = 'https://vmvhlgzwufkardaruutt.supabase.co';
const BUCKET       = 'progress-photos';
const UID          = '699996e5-8b97-4b58-b4ca-ea0234546d4a'; // Carolina (caritoacuna@gmail.com)
const TIPO         = 'inicio';

const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error('❌ Falta la key. Corré antes:  $env:SUPABASE_SERVICE_KEY="tu_service_role_key"'); process.exit(1); }

const [frentePath, espaldaPath] = process.argv.slice(2);
if (!frentePath || !espaldaPath) {
  console.error('❌ Uso: node scripts/subir-fotos-inicio.mjs "<ruta-FRENTE>" "<ruta-ESPALDA>"');
  process.exit(1);
}

const fecha = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (día de carga)

async function subir(filePath, vista) {
  if (!fs.existsSync(filePath)) throw new Error(`No existe el archivo: ${filePath}`);
  // Comprimir/normalizar como la app (respeta orientación EXIF, jpeg de buen tamaño).
  const jpg = await sharp(filePath).rotate().resize({ width: 1440, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `${UID}/${fecha}-${vista}-${Date.now()}-${rand}.jpg`;

  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'false' },
    body: jpg,
  });
  if (!up.ok) throw new Error(`upload ${vista}: ${up.status} ${await up.text()}`);

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/fotos_progreso`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ usuario_id: UID, fecha, url_foto: publicUrl, tipo: TIPO, vista }),
  });
  if (!ins.ok) {
    // rollback del blob si falla la fila (evita huérfanos), igual que la app
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, { method: 'DELETE', headers: { Authorization: `Bearer ${KEY}` } }).catch(() => {});
    throw new Error(`db ${vista}: ${ins.status} ${await ins.text()}`);
  }
  console.log(`✓ ${vista.padEnd(7)} → ${path}`);
}

(async () => {
  try {
    await subir(frentePath, 'frente');
    await subir(espaldaPath, 'espalda');
    console.log('\n✅ Listo — fotos de inicio de Carolina cargadas (frente + espalda).');
  } catch (e) {
    console.error('\n❌', e.message);
    process.exit(1);
  }
})();
