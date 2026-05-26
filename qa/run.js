// CoachAI Pro QA — parallel multi-persona orchestrator
//
// Spawns the smoke flow for N personas concurrently against the same base
// URL. Aggregates pass/fail across runs and exits non-zero if ANY persona
// fails. The smoke runs are fully isolated (separate Chrome processes,
// separate browser profiles) so a bug in one persona's flow can't poison
// another's run.
//
// USAGE:
//   node qa/run.js                              # default: 1 persona (testb) on localhost
//   node qa/run.js --personas testb,qa1,qa2     # 3 personas in parallel
//   node qa/run.js --base https://coach-ai-pearl.vercel.app --personas qa1,qa2,qa3
//
// The harness assumes:
//   - On localhost: the dev server is up at the --base URL (default :3030)
//   - On prod: network is reachable + the AI API is responding
//   - For non-testb personas: cleanup happens in a separate pass (see
//     qa/cleanup.js) — this runner does not delete users so you can inspect
//     state after a failed run.

const { spawn } = require('child_process');
const path = require('path');

function parseArgs() {
  const args = { base: 'http://localhost:3030', personas: ['testb'], verbose: false };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--base') args.base = process.argv[++i];
    else if (a === '--personas') args.personas = process.argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--verbose') args.verbose = true;
  }
  return args;
}

function runOne(persona, base, verbose) {
  return new Promise((resolve) => {
    const args = ['qa/smoke.js', '--base', base, '--persona', persona];
    if (verbose) args.push('--verbose');
    const child = spawn(process.execPath, args, {
      cwd: path.resolve(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); if (verbose) process.stderr.write(`[${persona}] ${d}`); });
    child.on('close', (code) => {
      let report = null;
      try { report = JSON.parse(stdout); } catch (e) { /* malformed — keep as raw */ }
      resolve({ persona, exitCode: code, report, stdoutRaw: report ? null : stdout, stderr });
    });
  });
}

async function main() {
  const args = parseArgs();
  console.log(`\n[qa-run] base=${args.base} personas=${args.personas.join(',')} starting in parallel...\n`);
  const startedAt = Date.now();
  const results = await Promise.all(args.personas.map(p => runOne(p, args.base, args.verbose)));
  const totalMs = Date.now() - startedAt;

  // Summary table
  console.log('\n=========================================================');
  console.log(`[qa-run] RESULTS  (total ${(totalMs/1000).toFixed(1)}s)`);
  console.log('=========================================================');
  let anyFailed = false;
  for (const r of results) {
    if (!r.report) {
      console.log(`  ✗ ${r.persona.padEnd(8)}  CRASHED (exit ${r.exitCode}) — no JSON report`);
      if (r.stderr) console.log(`         stderr: ${r.stderr.slice(0, 200)}`);
      anyFailed = true;
      continue;
    }
    const rep = r.report;
    const passed = rep.steps.filter(s => s.ok).length;
    const failed = rep.steps.filter(s => s.ok === false).length;
    const status = rep.passed ? '✓' : '✗';
    console.log(`  ${status} ${r.persona.padEnd(8)}  ${passed}/${rep.steps.length} steps passed  (${(rep.totalMs/1000).toFixed(1)}s)`);
    if (failed > 0) {
      for (const s of rep.steps) {
        if (s.ok === false) console.log(`         · ${s.name}: ${s.error}`);
      }
    }
    if (rep.consoleErrors.length > 0) {
      console.log(`         · ${rep.consoleErrors.length} console error(s):`);
      for (const e of rep.consoleErrors.slice(0, 5)) console.log(`            - ${e.slice(0, 200)}`);
    }
    if (rep.pageErrors.length > 0) {
      console.log(`         · ${rep.pageErrors.length} page error(s):`);
      for (const e of rep.pageErrors.slice(0, 5)) console.log(`            - ${e.slice(0, 200)}`);
    }
    if (!rep.passed) anyFailed = true;
  }
  console.log('=========================================================\n');
  process.exit(anyFailed ? 1 : 0);
}

main().catch(err => { console.error('[qa-run] uncaught:', err); process.exit(3); });
