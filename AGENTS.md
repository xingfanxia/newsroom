<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project Documentation Routing

Start with [`docs/README.md`](./docs/README.md) before using historical plans
or handoffs as implementation guidance. Runtime code remains authoritative; if
docs and code conflict, fix the relevant current doc in the same change.

## Production Deployments

Production deploys come only from the git integration on `main`. Never create a
CLI deployment with a production target (`--prod`, `--target=production`) for
this project — not even `--skip-domain` or from another directory: it rebinds
every Vercel cron to its own `vercel.json`, and a 2026-09-07 audit deploy with
no crons stopped the whole pipeline for 78h. See
[`docs/operations/production-monitoring.md`](./docs/operations/production-monitoring.md).
