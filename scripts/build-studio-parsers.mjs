// ============================================================================
// BUILD-STUDIO-PARSERS — copia FIEL de los parsers de planes de la app a Studio
// ============================================================================
// Studio (studio/index.html) frena el guardado de un plan que la app de la
// clienta no puede leer (casos Roxana 2026-10-23 y Ana 2026-10-28: dieta cruda →
// Alimentación vacía + evento `plan_unparseable_on_load`). Para que "lo que
// Studio acepta" sea EXACTAMENTE "lo que la app lee", Studio usa las mismas
// funciones que index.html — no una heurística propia:
//   planReplyHasStructure · parseDietaContenido · parseRutinaContenido
//
// Este script las extrae del index.html vivo y regenera el bloque marcado
// en studio/index.html (entre los comentarios BEGIN/END studio-plan-parsers):
//
//   node scripts/build-studio-parsers.mjs          → regenera el bloque
//   node scripts/build-studio-parsers.mjs --check  → falla si Studio quedó
//                                                     distinto de index.html
//
// El pre-commit corre el --check cuando el commit toca index.html o Studio:
// si alguien cambia un parser de la app sin regenerar, el commit no pasa.
// NO toca index.html.
// ============================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFunction } from './build-chat-prompt.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, '..');
const INDEX = join(RAIZ, 'index.html');
const STUDIO = join(RAIZ, 'studio', 'index.html');

const FUNCIONES = ['planReplyHasStructure', 'parseRutinaContenido', 'parseDietaContenido'];
const BEGIN = '<!-- BEGIN studio-plan-parsers';
const END = '<!-- END studio-plan-parsers -->';

function generarBloque() {
  const html = readFileSync(INDEX, 'utf8');
  const fns = FUNCIONES.map(n => extractFunction(html, n));
  // index.html tiene finales de línea mixtos (autocrlf de Windows): todo a LF
  // acá; al escribir se adapta al EOL de Studio.
  const cuerpo = fns.join('\n\n').replace(/\r\n/g, '\n');
  if (/<\/script/i.test(cuerpo)) throw new Error('Un parser contiene "</script" — rompería el HTML de Studio');
  return `${BEGIN} — GENERADO por scripts/build-studio-parsers.mjs desde index.html. NO editar a mano: correr \`npm run studio:parsers\`. -->
  <script>
  // Parsers REALES de la app (copia fiel). Studio los usa para no guardar un
  // plan que la clienta vería vacío. Expuestos como window.StudioPlanParsers.
  window.StudioPlanParsers = (function () {
  "use strict";
  // parseRutinaContenido usa \`lang\` para el label de descanso; Studio es es.
  let lang = 'es';

${cuerpo}

  return { ${FUNCIONES.join(', ')} };
  })();
  </script>
  ${END}`;
}

function bloqueActual(studio) {
  const a = studio.indexOf(BEGIN);
  const b = studio.indexOf(END);
  if (a === -1 || b === -1 || b < a) throw new Error('No encontré los marcadores studio-plan-parsers en studio/index.html');
  return { a, b: b + END.length, texto: studio.slice(a, b + END.length) };
}

const check = process.argv.includes('--check');
const studio = readFileSync(STUDIO, 'utf8');
const crlf = studio.includes('\r\n');
const lf = generarBloque();
const nuevo = crlf ? lf.replace(/\n/g, '\r\n') : lf;
const { a, b, texto } = bloqueActual(studio);

if (check) {
  // Comparar sin importar CRLF/LF (git en Windows convierte finales de línea).
  if (texto.replace(/\r\n/g, '\n') !== lf) {
    console.error('✗ studio-plan-parsers DESINCRONIZADO: los parsers de index.html cambiaron y Studio tiene la copia vieja.');
    console.error('  Corré: npm run studio:parsers   (y sumá studio/index.html al commit)');
    process.exit(1);
  }
  console.log('✓ studio-plan-parsers en paridad con index.html');
} else {
  if (texto === nuevo) { console.log('= studio-plan-parsers ya estaba al día'); process.exit(0); }
  writeFileSync(STUDIO, studio.slice(0, a) + nuevo + studio.slice(b));
  console.log('✓ studio-plan-parsers regenerado en studio/index.html');
}
