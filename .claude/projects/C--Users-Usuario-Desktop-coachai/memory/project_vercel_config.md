---
name: Vercel deployment config
description: Required env vars and deployment notes for CoachAI on Vercel
type: project
---

Required env var: `ANTHROPIC_API_KEY` — must be set in Vercel project settings.

**Why:** When the GitHub repo was renamed (coachai → CoachAi), Vercel created a new project without the env var, silently breaking the AI chat.

**How to apply:** Any time we touch deployment config, rename repos, or see Vercel-related issues, verify `ANTHROPIC_API_KEY` is set. If the git push output shows "This repository moved", flag it to the user immediately — it means Vercel's project linkage may have drifted.

Documented in `.env.example` in the repo root.

Production URL: https://coach-ai-pearl.vercel.app/
Canonical Vercel project: coach-ai — any other project is a duplicate and must be ignored.
