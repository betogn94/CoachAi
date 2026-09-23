// ============================================================================
// SUBIR DEMO DE EJERCICIO — sube el clip mp4 (+ frames de respaldo) de un
// ejercicio al bucket público exercise-gifs y actualiza su ficha en
// ejercicios_biblioteca (video_url + frame_0_url/frame_1_url).
//
// La carpeta debe contener: video.mp4 (obligatorio), 0.jpg y 1.jpg (opcionales,
// frames de respaldo para apps con versión vieja cacheada; también es el poster).
//
// USO (desde la carpeta del repo, PowerShell):
//   $env:SUPABASE_SERVICE_KEY="TU_SERVICE_ROLE_KEY"
//   node scripts/subir-demo-ejercicio.mjs <slug> "<nombre_es exacto>" "<carpeta>"
//
// Ejemplo:
//   node scripts/subir-demo-ejercicio.mjs almejas "Almejas" "C:\videos\almejas"
//
// La service_role key: Supabase → Settings → API → "service_role".
// Queda SOLO en tu terminal — no se guarda en ningún lado.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const SUPABASE_URL = 'https://vmvhlgzwufkardaruutt.supabase.co';
const BUCKET       = 'exercise-gifs';

const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error('❌ Falta la key. Corré antes:  $env:SUPABASE_SERVICE_KEY="tu_service_role_key"'); process.exit(1); }

const [slug, nombreEs, carpeta] = process.argv.slice(2);
if (!slug || !nombreEs || !carpeta) {
  console.error('❌ Uso: node scripts/subir-demo-ejercicio.mjs <slug> "<nombre_es>" "<carpeta>"');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${KEY}`, apikey: KEY };

async function subir(archivo, contentType) {
  const local = path.join(carpeta, archivo);
  if (!fs.existsSync(local)) return null;
  const destino = `${slug}/${archivo}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${destino}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: fs.readFileSync(local),
  });
  if (!res.ok) throw new Error(`upload ${destino}: ${res.status} ${await res.text()}`);
  const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${destino}`;
  console.log(`  ✓ ${archivo} → ${url}`);
  return url;
}

const videoUrl = await subir('video.mp4', 'video/mp4');
if (!videoUrl) { console.error(`❌ No encontré video.mp4 en ${carpeta}`); process.exit(1); }
const f0 = await subir('0.jpg', 'image/jpeg');
const f1 = await subir('1.jpg', 'image/jpeg');

// Actualizar la ficha (solo pisa frames si vinieron en la carpeta)
const patch = { video_url: videoUrl };
if (f0) patch.frame_0_url = f0;
if (f1) patch.frame_1_url = f1;
const res = await fetch(`${SUPABASE_URL}/rest/v1/ejercicios_biblioteca?nombre_es=eq.${encodeURIComponent(nombreEs)}`, {
  method: 'PATCH',
  headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify(patch),
});
const rows = await res.json();
if (!res.ok || !Array.isArray(rows) || rows.length !== 1) {
  console.error(`❌ La ficha "${nombreEs}" no se actualizó bien:`, JSON.stringify(rows));
  process.exit(1);
}
console.log(`✓ Ficha "${nombreEs}" actualizada (video_url${f0 ? ' + frames' : ''}). Listo.`);
