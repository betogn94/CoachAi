# CoachAI Pro — QA harness

Headless-Chrome e2e smoke tests for the critical app flows. Catches
regressions in onboarding/login, chat plan delivery, navigation, and
persistence — without burning hours of manual clicking.

## Phase 0 (now): single user, local, mocked API

The `testb` persona logs in as the existing `testb@test.com` account
(skips onboarding) and walks through:

1. Landing → login → app
2. Dismiss tour
3. Home renders
4. Chat opens, quick-buttons present (Dieta + Rutina)
5. Tap **Dieta** → wait until `weeklyPlans.dieta` is populated
6. Tap **Rutina** → wait until `weeklyPlans.rutina` is populated
7. Quick-buttons row should be empty (both plans delivered)
8. Mi Entreno renders the saved routine
9. Mi Alimentación renders the saved diet
10. Perfil renders
11. Back to Home — verify no crash on full nav round-trip

Console + page errors are collected throughout. The script exits non-zero
if any step fails.

```bash
# Run against local dev server (mocked /api/chat — no Anthropic API spend)
node qa/run.js

# Run against prod with real AI (~$0.04/persona on Haiku 4.5)
node qa/run.js --base https://coach-ai-pearl.vercel.app --personas testb

# 3 personas in parallel against prod (Phase 1)
node qa/run.js --base https://coach-ai-pearl.vercel.app --personas qa1,qa2,qa3
```

## Phase 1 (next): multi-user, prod, real API

Personas `qa1` / `qa2` / `qa3` exist in `personas.js` with distinct
onboarding profiles (hipertrofia/intermedio, definir/inicial, perdida_grasa/avanzado).
The smoke flow needs an onboarding walker before these can run — that's
the Phase 1 work. Once that lands, `node qa/run.js --personas qa1,qa2,qa3`
gives parallel multi-user coverage.

Cleanup (DELETE the qa-*@coachai-qa.test users) happens in a separate pass
so a failed run leaves the DB inspectable.

## Schedule

A weekly cron (Monday morning) pings to run the harness against prod.
The reminder is set up via the assistant's scheduled-tasks tool — when
it fires, confirm before running so we don't burn API spend on something
you didn't intend.
