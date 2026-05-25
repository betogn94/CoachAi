// One-off Puppeteer script to capture the 4 brief screenshots.
// Uses the locally-installed Chrome; saves PNGs to design/screens/.
//
// Usage: node design/capture-screens.js
//
// Prereq: the local dev server must be serving the app at http://localhost:3030
// and TestB must be set up with a sample closed week (insertion SQL is run by
// the caller, not this script).

const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:3030/';
const OUT = path.join(__dirname, 'screens');
fs.mkdirSync(OUT, { recursive: true });

async function settled(page, ms = 600) { await new Promise(r => setTimeout(r, ms)); }

async function loginAsTestB(page) {
  await page.goto(URL + '?_v=' + Date.now(), { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#el-nombre', { timeout: 10000 });
  await page.type('#el-nombre', 'TestB');
  await page.type('#el-email', 'testb@test.com');
  // Find + click "Ingresar"
  const btn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /ingresar/i.test(x.textContent));
    if (!b) return null;
    b.click();
    return true;
  });
  if (!btn) throw new Error('Login button not found');
  // Wait for login to settle (app-active class + landing-wrapper hidden)
  await page.waitForFunction(() => document.body.classList.contains('app-active'), { timeout: 15000 });
  await settled(page, 2500);
  // Dismiss tour overlay if present
  await page.evaluate(() => {
    try { endTour && endTour(true); } catch (e) {}
    const t = document.getElementById('tour-overlay'); if (t) t.style.display = 'none';
  });
  await settled(page, 400);
}

async function snap(page, name, opts = {}) {
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file, fullPage: opts.fullPage || false });
  console.log('  ✓', file, '(' + (fs.statSync(file).size / 1024).toFixed(1) + ' KB)');
}

(async () => {
  console.log('Launching Chrome…');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    defaultViewport: { width: 375, height: 812, deviceScaleFactor: 2 },
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();

  try {
    console.log('Logging in as TestB…');
    await loginAsTestB(page);

    // ─────────────────────────────────────────────
    // Screen 1 — HOME TOP (hero ring + 4 cards)
    // ─────────────────────────────────────────────
    console.log('Screen 1: Home top');
    await page.evaluate(() => { showHome(); window.scrollTo(0, 0); });
    await settled(page, 1800);
    await page.evaluate(() => {
      // Force-render the populated home widgets even without _alimDays
      if (typeof renderHomeProximaComida === 'function') renderHomeProximaComida();
      if (typeof renderHomeHoyToca === 'function') renderHomeHoyToca();
      if (typeof renderHomeKcalChart === 'function') renderHomeKcalChart();
      window.scrollTo(0, 0);
    });
    await settled(page, 600);
    await snap(page, '01-home-top');

    // ─────────────────────────────────────────────
    // Screen 2 — SEGUIMIENTO SEMANAL (En curso + Cerrada colapsada)
    // ─────────────────────────────────────────────
    console.log('Screen 2: Seguimiento Semanal mixed states');
    await page.evaluate(() => {
      document.getElementById('semanas-container')?.scrollIntoView({ block: 'center' });
    });
    await settled(page, 700);
    await snap(page, '02-seguimiento-mixed');

    // ─────────────────────────────────────────────
    // Screen 3 — Semana cerrada expandida (análisis + fotos)
    // ─────────────────────────────────────────────
    console.log('Screen 3: Closed week expanded');
    await page.evaluate(() => {
      // Collapse week 2 + expand week 1 (the closed one)
      try { toggleSemana(2); } catch (e) {}
    });
    await settled(page, 400);
    await page.evaluate(() => {
      const w1 = document.getElementById('semana-card-1');
      if (w1 && !w1.classList.contains('open')) { try { toggleSemana(1); } catch (e) {} }
      w1?.scrollIntoView({ block: 'start' });
    });
    await settled(page, 1200); // wait for photos to load
    await snap(page, '03-semana-cerrada-expanded');

    // ─────────────────────────────────────────────
    // Screen 4 — Modal Cierre de Semana
    // ─────────────────────────────────────────────
    console.log('Screen 4: Cierre modal');
    await page.evaluate(() => {
      // Collapse week 1 + open week 2 (current) + click cerrar semana
      try { toggleSemana(1); } catch (e) {}
    });
    await settled(page, 400);
    await page.evaluate(() => {
      const w2 = document.getElementById('semana-card-2');
      if (w2 && !w2.classList.contains('open')) { try { toggleSemana(2); } catch (e) {} }
    });
    await settled(page, 400);
    await page.evaluate(() => {
      document.querySelector('.btn-cerrar-semana')?.click();
    });
    await settled(page, 1500);
    await snap(page, '04-cierre-modal');

    console.log('\nAll screens captured ✓');
  } finally {
    await browser.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
