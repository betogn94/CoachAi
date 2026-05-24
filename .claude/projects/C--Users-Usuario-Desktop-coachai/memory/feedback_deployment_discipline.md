---
name: Deployment discipline rules
description: Strict rules for repo, Vercel, and deployment changes — mandatory, no exceptions
type: feedback
---

Never create a new Vercel project, rename the project, or trigger re-linking. Reuse the existing production project only.

**Why:** A repo rename caused Vercel to silently create a new project without env vars, breaking production and wasting debugging time.

**How to apply:**
- Production project name: `coach-ai` | URL: `https://coach-ai-pearl.vercel.app/`
- One repo, one main branch, one Vercel project, one Supabase project — always
- Before any deployment-related change: verify linked project, env vars, and production URL are intact
- Never run commands that reinitialize or reconnect Vercel unless explicitly requested
- Never modify or overwrite env vars automatically
- Before pushing anything touching config/infra: explain what will change first, then wait for approval
- If uncertain about deployment impact: STOP and ask
- Stability first — never break a working system while fixing another

**Naming (canonical, never deviate):**
- Repo: `CoachAI` — never `coachai`, `CoachAi`, `coach-ai`, or any other variation
- Case sensitivity matters: Git, Vercel, and deployment systems can silently create duplicate configs on case changes
- Never rename local folders, remote origins, Vercel project links, or package identifiers without explicit approval

**Before ANY infra/config/git operation, verify:**
1. Current repo name matches `CoachAI`
2. Linked Vercel project is `coach-ai` → `https://coach-ai-pearl.vercel.app/`
3. Current branch and remote origin are correct

**Never run:** `vercel init`, `vercel link`, `vercel project add` unless explicitly requested.
**Never create** duplicate deployment configs or `.vercel/project.json` mismatches.

**Core principle:** A working stable system is more important than aggressive automation. If any operation could affect Git history, Vercel linkage, env vars, or production deploys — STOP and explain first.
