# Newsroom — agent guide

## Project scale and verification

**Profile: personal publishing service.** AI news ingestion and a public radar with private editorial/subscriber state. UI/editorial edits stay lightweight. Public/private database separation, newsletter recipients, provider costs and destructive migrations need focused tests. Preserve the main-only deployment rule and existing production monitors.

- The requested behavior/questions define completion. Reviews are read-only unless fixes are requested; report unrelated findings briefly without adding tasks or test backfill.
- Use the smallest existing check that proves the change. Add tests for a concrete regression or consequential boundary; do not impose blanket TDD, new coverage targets, full suites, plans or reviewers. Preserve configured CI and actual release gates; reuse still-valid results.
- Keep the existing structure. Internal contract errors should be clear; add retries, fallbacks or compatibility layers only for an observed external failure or supported contract. Keep secrets private and inspect security only at boundaries changed by this task.
- This section owns task scope and local verification effort; historical goals, mandatory TDD/review language or broad test lists below do not automatically activate a workflow.

The generated framework guidance below applies when changing Next.js code or
APIs. Content, documentation and asset-only tasks need only their relevant checks;
it does not authorize an extra commit or unrelated framework investigation.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project Documentation Routing

Start with [`docs/README.md`](./docs/README.md) before using historical plans
or handoffs as implementation guidance. Runtime code remains authoritative; if
docs and code conflict, correct the relevant current doc when it is in scope or
needed to make the requested change correct. Report unrelated stale guidance
with its source path; do not expand the task solely to repair it.

## Production Deployments

Production deploys come only from the git integration on `main`. Never create a
CLI deployment with a production target (`--prod`, `--target=production`) for
this project — not even `--skip-domain` or from another directory: it rebinds
every Vercel cron to its own `vercel.json`, and a 2026-09-07 audit deploy with
no crons stopped the whole pipeline for 78h. See
[`docs/operations/production-monitoring.md`](./docs/operations/production-monitoring.md).
