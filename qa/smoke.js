// CoachAI Pro QA — smoke flow runner
//
// Drives a headless Chrome through the critical app flows for ONE user
// persona. Designed to be invoked by qa/run.js for parallel multi-user
// execution. Each persona logs in (or creates a user) and walks through:
//   1. Login + skip tour
//   2. Home renders cleanly
//   3. Chat: tap Dieta button → wait for AI delivery → assert persistence
//   4. Chat: tap Rutina button → wait for AI delivery → assert persistence
//   5. Mi Entreno renders the saved routine
//   6. Mi Alimentación renders the saved diet
//   7. Navigate Perfil + Seguimiento Semanal without errors
//
// Returns a structured report. Console errors collected throughout.
//
// USAGE (single user, local with mocked API — Phase 0):
//   node qa/smoke.js --base http://localhost:3030 --persona testb
//
// USAGE (single user, prod with real API — Phase 1):
//   node qa/smoke.js --base https://coach-ai-pearl.vercel.app --persona qa1
//
// Personas are defined in qa/personas.js. The default 'testb' persona uses
// the existing TestB account (skip onboarding). 'qa1'..'qa3' are designed
// to be created fresh and cleaned up afterwards (see qa/cleanup.js).

const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PERSONAS = require('./personas.js');

function parseArgs() {
  const args = { base: 'http://localhost:3030', persona: 'testb', headed: false, verbose: false };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--base') args.base = process.argv[++i];
    else if (a === '--persona') args.persona = process.argv[++i];
    else if (a === '--headed') args.headed = true;
    else if (a === '--verbose') args.verbose = true;
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const persona = PERSONAS[args.persona];
  if (!persona) {
    console.error(`[qa] unknown persona "${args.persona}". Available: ${Object.keys(PERSONAS).join(', ')}`);
    process.exit(2);
  }

  const startedAt = Date.now();
  const report = {
    persona: args.persona,
    base: args.base,
    startedAt: new Date(startedAt).toISOString(),
    steps: [],
    consoleErrors: [],
    pageErrors: [],
    passed: true,
  };
  // Verbose logs go to stderr so they don't pollute the JSON report on stdout
  // (qa/run.js parses stdout as JSON when smoke runs as a subprocess).
  const log = (msg) => { if (args.verbose) process.stderr.write(`[${args.persona}] ${msg}\n`); };
  function startStep(name) {
    const t = Date.now();
    const s = { name, ok: null, durationMs: 0, error: null };
    report.steps.push(s);
    return {
      pass: () => { s.ok = true; s.durationMs = Date.now() - t; log(`✓ ${name} (${s.durationMs}ms)`); },
      fail: (err) => { s.ok = false; s.error = String(err && err.message || err); s.durationMs = Date.now() - t; report.passed = false; log(`✗ ${name}: ${s.error}`); },
    };
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: args.headed ? false : 'new',
      defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
      args: ['--no-sandbox'],
    });
    const page = await browser.newPage();

    // Collect console + page errors throughout the run.
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Suppress known harmless console errors from external SDKs (e.g.,
        // Supabase RLS warnings on read-public tables in some flows).
        if (text.includes('PGRST116')) return;
        report.consoleErrors.push(text);
      }
    });
    page.on('pageerror', err => report.pageErrors.push(String(err)));

    // --- Step 1: Load + login ---
    let st = startStep('load_and_login');
    try {
      await page.goto(`${args.base}/?_qa=${startedAt}`, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForSelector('#el-nombre', { timeout: 10000 });
      await page.type('#el-nombre', persona.nombre);
      await page.type('#el-email', persona.email);
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find(b => /ingresar/i.test(b.textContent || ''));
        if (btn) btn.click();
      });
      // app-active class flips on once the session is set up
      await page.waitForFunction(() => document.body.classList.contains('app-active'), { timeout: 20000 });
      st.pass();
    } catch (e) { st.fail(e); }

    // --- Step 2: Dismiss tour overlay ---
    st = startStep('dismiss_tour');
    try {
      await page.evaluate(() => {
        try { if (typeof endTour === 'function') endTour(true); } catch (e) {}
        const t = document.getElementById('tour-overlay');
        if (t) t.style.display = 'none';
      });
      st.pass();
    } catch (e) { st.fail(e); }

    // --- Step 3: Verify Home renders without throwing ---
    st = startStep('home_renders');
    try {
      await page.evaluate(() => { if (typeof showHome === 'function') showHome(); });
      await new Promise(r => setTimeout(r, 800));
      const ok = await page.evaluate(() => {
        const w = document.getElementById('home-wrapper');
        return !!w && getComputedStyle(w).display !== 'none' && w.offsetHeight > 0;
      });
      if (!ok) throw new Error('home-wrapper not visible after showHome()');
      st.pass();
    } catch (e) { st.fail(e); }

    // --- Step 4: Navigate to Chat ---
    st = startStep('chat_opens');
    try {
      await page.evaluate(() => { if (typeof showChat === 'function') showChat(); });
      await page.waitForFunction(() => {
        const w = document.getElementById('chat-wrapper');
        return w && getComputedStyle(w).display !== 'none';
      }, { timeout: 5000 });
      st.pass();
    } catch (e) { st.fail(e); }

    // --- Step 5: Reset weeklyPlans + dismissed buttons (clean slate per run) ---
    // Note: weeklyPlans, pendingPlanDelivery, dismissedPlanButtons are `let`
    // bindings at module scope, so plain rebind via `weeklyPlans = ...` from
    // eval() only creates a global property and DOES NOT affect the original
    // binding the app reads from. We have to MUTATE in place where possible
    // (set fields to null, .clear() the Set) and tolerate that
    // pendingPlanDelivery can't be reliably reset from outside — it's null
    // on a fresh load anyway, which is what we have here. Also overrides
    // the /api/chat mock to return a long reply that passes the persist
    // gate (>400 chars + plan markers); the in-app default mock is short.
    st = startStep('reset_chat_state');
    try {
      // Per-persona cardio fixtures — each agent exercises a different
      // frequency pattern so the parser + UI render gets coverage across
      // all 3 cases (entreno-only, every-day, off-days-only). Also varies
      // tipo/intensidad/duración so the parser's field extraction is
      // exercised broadly.
      const CARDIO_FIXTURES = {
        testb: {
          line:        '🏃 CARDIO: post entreno 25 min caminata moderada',
          expect:      { duracion_min: 25, tipo: 'caminata', intensidad: 'moderada', frecuencia: 'entreno' },
        },
        qa1: {
          line:        '🏃 CARDIO: post entreno 15 min HIIT intenso',
          expect:      { duracion_min: 15, tipo: 'HIIT', intensidad: 'intensa', frecuencia: 'entreno' },
        },
        qa2: {
          line:        '🏃 CARDIO: todos los días 30 min caminata suave',
          expect:      { duracion_min: 30, tipo: 'caminata', intensidad: 'suave', frecuencia: 'todos' },
        },
        qa3: {
          line:        '🏃 CARDIO: días off 45 min trote moderado',
          expect:      { duracion_min: 45, tipo: 'trote', intensidad: 'moderada', frecuencia: 'descanso' },
        },
      };
      const cardioFixture = CARDIO_FIXTURES[args.persona] || CARDIO_FIXTURES.testb;

      await page.evaluate((cardioLine) => {
        try { if (typeof weeklyPlans !== 'undefined' && weeklyPlans) { weeklyPlans.dieta = null; weeklyPlans.rutina = null; } } catch (e) {}
        try { if (typeof dismissedPlanButtons !== 'undefined' && dismissedPlanButtons && dismissedPlanButtons.clear) dismissedPlanButtons.clear(); } catch (e) {}
        try { if (typeof refreshQuickButtons === 'function') refreshQuickButtons(); } catch (e) {}

        // Override fetch for /api/chat to return a long, plan-shaped reply
        // that triggers the persist gate. Different content per tipo so the
        // type-detection works correctly.
        const buildDietaReply = () =>
          'Plan nutricional — TestB | Target: 2280 kcal/dia | P:171g C:228g G:76g\n\n' +
          'LUNES\nDesayuno: avena 50g + leche 200ml + plátano — 320 kcal\nAlmuerzo: pollo 200g + arroz 150g + brócoli — 620 kcal\nMerienda: yogur + nueces — 280 kcal\nCena: salmón 180g + batata 200g — 540 kcal\n\n' +
          'MARTES\nDesayuno: huevos 3 + avena 40g — 340 kcal\nAlmuerzo: ternera 180g + quinoa 120g — 580 kcal\nMerienda: queso + frutas — 250 kcal\nCena: pollo 200g + verduras — 480 kcal\n\n' +
          'MIERCOLES\nDesayuno: tostadas + palta + huevos — 410 kcal\nAlmuerzo: atún + arroz + ensalada — 560 kcal\nMerienda: licuado proteína — 320 kcal\nCena: pavo + papas — 520 kcal\n\n' +
          'JUEVES\nDesayuno: avena + frutos rojos — 360 kcal\nAlmuerzo: pollo + arroz integral — 600 kcal\nMerienda: yogur griego — 240 kcal\nCena: pescado + verduras — 460 kcal\n';
        // Routine body + per-persona CARDIO line appended at the end.
        // (The parser does a top-down scan for the first CARDIO line so
        // position doesn't matter, but the AI prompt places it after the
        // rest-day block — we mirror that here.)
        const buildRutinaReply = () =>
          'Rutina semanal — TestB | Foco: hipertrofia + control de progresión\n\n' +
          'LUNES — Pecho/Tríceps\n• Press banca 4 series x 8 reps — descanso: 90s\n• Aperturas con mancuernas 3 series x 12 reps — descanso: 60s\n• Press militar 4 series x 10 reps — descanso: 90s\n• Fondos paralelas 3 series x 10 reps — descanso: 75s\n\n' +
          'MARTES — Espalda/Bíceps\n• Dominadas 4 series x 8 reps — descanso: 90s\n• Remo barra 4 series x 10 reps — descanso: 90s\n• Curl barra 3 series x 12 reps — descanso: 60s\n• Curl martillo 3 series x 12 reps — descanso: 60s\n\n' +
          'JUEVES — Piernas\n• Sentadilla 4 series x 8 reps — descanso: 120s\n• Peso muerto 4 series x 6 reps — descanso: 120s\n• Prensa 45° 3 series x 12 reps — descanso: 90s\n• Curl femoral 3 series x 12 reps — descanso: 60s\n\n' +
          'VIERNES — Hombros/Core\n• Press militar 4 series x 10 reps — descanso: 90s\n• Elevaciones laterales 3 series x 15 reps — descanso: 60s\n• Plancha 3 series x 60s — descanso: 45s\n\n' +
          '🛋️ Descanso: sábado y domingo — caminata, movilidad o estiramientos 20-30 min.\n\n' +
          cardioLine;

        const orig = window.fetch.bind(window);
        window.fetch = async (url, opts) => {
          const u = typeof url === 'string' ? url : (url && url.url || '');
          if (u.includes('/api/chat')) {
            await new Promise(r => setTimeout(r, 200));
            // Inspect the LAST user message to decide reply type
            let body = {};
            try { body = JSON.parse(opts && opts.body || '{}'); } catch (e) {}
            const lastUser = (body.messages || []).filter(m => m.role === 'user').pop();
            const txt = (lastUser && lastUser.content || '').toLowerCase();
            const isRutina = /rutina|workout|training/.test(txt);
            const reply = isRutina ? buildRutinaReply() : buildDietaReply();
            return new Response(JSON.stringify({ content: [{ type: 'text', text: reply }] }),
              { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          return orig(url, opts);
        };
      }, cardioFixture.line);
      // Stash fixture for later steps
      report.cardioFixture = cardioFixture;
      const btnCount = await page.evaluate(() => document.querySelectorAll('#quick-btns .qbtn-card').length);
      if (btnCount !== 2) throw new Error(`expected 2 quick-buttons (Dieta + Rutina), got ${btnCount}`);
      st.pass();
    } catch (e) { st.fail(e); }

    // --- Step 6: Tap Dieta → wait for delivery → assert persistence ---
    st = startStep('plan_dieta_delivered');
    try {
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('#quick-btns .qbtn-card')].find(b => b.classList.contains('is-dieta'));
        if (!btn) throw new Error('Dieta button not found');
        btn.click();
      });
      // Wait until either:
      //   - weeklyPlans.dieta gets populated (success), or
      //   - 30s pass with no progress (timeout)
      await page.waitForFunction(() => {
        try { return weeklyPlans && weeklyPlans.dieta && weeklyPlans.dieta.contenido; }
        catch (e) { return false; }
      }, { timeout: 30000, polling: 500 });
      st.pass();
    } catch (e) { st.fail(e); }

    // --- Step 7: Tap Rutina → wait for delivery → assert persistence ---
    st = startStep('plan_rutina_delivered');
    try {
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('#quick-btns .qbtn-card')].find(b => b.classList.contains('is-rutina'));
        if (!btn) throw new Error('Rutina button not found (already dismissed?)');
        btn.click();
      });
      await page.waitForFunction(() => {
        try { return weeklyPlans && weeklyPlans.rutina && weeklyPlans.rutina.contenido; }
        catch (e) { return false; }
      }, { timeout: 30000, polling: 500 });
      st.pass();
    } catch (e) { st.fail(e); }

    // --- Step 8: After both plans delivered, the quick-btns row should be empty ---
    st = startStep('quick_btns_emptied_after_both_plans');
    try {
      await new Promise(r => setTimeout(r, 600));
      const remaining = await page.evaluate(() => document.querySelectorAll('#quick-btns .qbtn-card').length);
      if (remaining !== 0) throw new Error(`expected 0 quick-buttons after both plans delivered, got ${remaining}`);
      st.pass();
    } catch (e) { st.fail(e); }

    // --- Step 9: Mi Entreno renders the saved routine ---
    st = startStep('mi_entreno_renders');
    try {
      await page.evaluate(() => { if (typeof showMiEntreno === 'function') showMiEntreno(); });
      await new Promise(r => setTimeout(r, 1200));
      const ok = await page.evaluate(() => {
        const w = document.getElementById('mi-entreno-wrapper');
        return !!w && getComputedStyle(w).display !== 'none' && w.offsetHeight > 100;
      });
      if (!ok) throw new Error('mi-entreno-wrapper not visible / empty after showMiEntreno()');
      st.pass();
    } catch (e) { st.fail(e); }

    // --- Step 9b: Parse the cardio rule from the saved routine and match fixture ---
    st = startStep('cardio_rule_parses_match_fixture');
    try {
      const expected = report.cardioFixture && report.cardioFixture.expect;
      if (!expected) throw new Error('no cardio fixture stashed on report');
      const parsed = await page.evaluate(() => {
        try {
          const r = weeklyPlans && weeklyPlans.rutina;
          if (!r || !r.contenido) return { error: 'no rutina contenido' };
          if (typeof parseCardioRule !== 'function') return { error: 'parseCardioRule not defined' };
          return parseCardioRule(r.contenido);
        } catch (e) { return { error: String(e && e.message || e) }; }
      });
      if (!parsed || parsed.error) throw new Error('parser returned: ' + JSON.stringify(parsed));
      const mismatches = [];
      ['duracion_min', 'tipo', 'intensidad', 'frecuencia'].forEach(k => {
        if (parsed[k] !== expected[k]) mismatches.push(`${k}: expected="${expected[k]}" got="${parsed[k]}"`);
      });
      if (mismatches.length) throw new Error('cardio rule mismatch — ' + mismatches.join(' | '));
      report.cardioParsed = parsed;
      st.pass();
    } catch (e) { st.fail(e); }

    // --- Step 9c: Cardio chip renders correctly given today's day type ---
    // For "todos" → chip MUST render regardless of today being rest or training.
    // For "entreno" → chip renders only on training days.
    // For "descanso" → chip renders only on rest days.
    // We can't reliably know whether today is rest for each persona without
    // running buildTrainingDayMapping. So instead we force-open the hero card
    // (or pick a known training day), then check chip presence vs frequency
    // expectation.
    st = startStep('cardio_chip_renders_correctly');
    try {
      const expectedFreq = report.cardioFixture && report.cardioFixture.expect && report.cardioFixture.expect.frecuencia;
      const result = await page.evaluate((freq) => {
        // Find a training day to display (any non-rest day in the mapping)
        if (typeof buildTrainingDayMapping !== 'function') return { error: 'mapping fn missing' };
        const map = buildTrainingDayMapping();
        if (!map) return { error: 'no mapping' };
        const trainingIdx = Object.values(map.weekdayToRoutineIdx)[0];
        const restIdx = map.days.findIndex(d => d.isRest);
        const out = { freq, trainingIdx, restIdx, trainingChip: null, restChip: null };

        // Show a training day
        if (typeof _entOverrideIdx !== 'undefined' && trainingIdx != null) {
          window._entOverrideIdx = trainingIdx;
          if (typeof showMiEntreno === 'function') showMiEntreno();
        }
        // wait a tick — we can't await inside page.evaluate sync block; the
        // mi-entreno re-renders synchronously enough for the immediate DOM
        // check. If flakey, we'd wrap in a setTimeout poll.
        out.trainingChip = !!document.querySelector('.cai-ent-cardio-chip');

        // Now show a rest day (if any)
        if (restIdx >= 0 && typeof _entOverrideIdx !== 'undefined') {
          window._entOverrideIdx = restIdx;
          if (typeof showMiEntreno === 'function') showMiEntreno();
          out.restChip = !!document.querySelector('.cai-ent-cardio-chip');
        }
        return out;
      }, expectedFreq);

      if (result.error) throw new Error(result.error);

      // Expected presence based on frecuencia
      const expectTraining = (expectedFreq === 'entreno' || expectedFreq === 'todos');
      const expectRest     = (expectedFreq === 'descanso' || expectedFreq === 'todos');
      const failures = [];
      if (result.trainingIdx != null && result.trainingChip !== expectTraining) {
        failures.push(`training day: expected chip=${expectTraining}, got ${result.trainingChip}`);
      }
      if (result.restIdx >= 0 && result.restChip !== expectRest) {
        failures.push(`rest day: expected chip=${expectRest}, got ${result.restChip}`);
      }
      if (failures.length) throw new Error('frecuencia=' + expectedFreq + ' → ' + failures.join(' | '));
      report.cardioChipCheck = result;
      st.pass();
    } catch (e) { st.fail(e); }

    // --- Step 10: Mi Alimentación renders the saved diet ---
    st = startStep('mi_alim_renders');
    try {
      await page.evaluate(() => { if (typeof showDiario === 'function') showDiario(); });
      await new Promise(r => setTimeout(r, 1200));
      const ok = await page.evaluate(() => {
        const w = document.getElementById('diario-wrapper');
        return !!w && getComputedStyle(w).display !== 'none' && w.offsetHeight > 100;
      });
      if (!ok) throw new Error('diario-wrapper not visible / empty after showDiario()');
      st.pass();
    } catch (e) { st.fail(e); }

    // --- Step 11: Perfil renders ---
    st = startStep('perfil_renders');
    try {
      await page.evaluate(() => { if (typeof showPerfil === 'function') showPerfil(); });
      await new Promise(r => setTimeout(r, 1200));
      const ok = await page.evaluate(() => {
        const w = document.getElementById('perfil-wrapper');
        return !!w && getComputedStyle(w).display !== 'none' && w.offsetHeight > 100;
      });
      if (!ok) throw new Error('perfil-wrapper not visible / empty after showPerfil()');
      st.pass();
    } catch (e) { st.fail(e); }

    // --- Step 12: Back to Home — verify no crash on full round-trip ---
    st = startStep('back_to_home_clean');
    try {
      await page.evaluate(() => { if (typeof showHome === 'function') showHome(); });
      await new Promise(r => setTimeout(r, 800));
      const ok = await page.evaluate(() => {
        const w = document.getElementById('home-wrapper');
        return !!w && getComputedStyle(w).display !== 'none' && w.offsetHeight > 0;
      });
      if (!ok) throw new Error('Home failed to re-render after full nav round-trip');
      st.pass();
    } catch (e) { st.fail(e); }

  } catch (e) {
    report.fatalError = String(e && e.message || e);
    report.passed = false;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  report.finishedAt = new Date().toISOString();
  report.totalMs = Date.now() - startedAt;
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.passed ? 0 : 1);
}

main().catch(err => {
  console.error('[qa] uncaught:', err);
  process.exit(3);
});
