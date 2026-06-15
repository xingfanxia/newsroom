# Project Docs Index

This repo has many historical design plans and handoffs. Treat this file as
the routing layer before using a document as implementation guidance.

## Current Source Of Truth

Read these first for current architecture and operational behavior:

| Need | Current doc |
|---|---|
| Product surface, stack, environment groups, roadmap | [`../README.md`](../README.md) |
| Latest production state and recent incidents | [`HANDOFF.md`](./HANDOFF.md) |
| Ingestion, enrich, scoring, clustering, cron behavior | [`architecture/ingestion.md`](./architecture/ingestion.md) |
| Agent/API/MCP surface | [`agent-access/README.md`](./agent-access/README.md) |
| AI HOT integration and daily-column input | [`aihot-integration/PLAN.md`](./aihot-integration/PLAN.md) |
| Security/RLS hardening notes | [`security/2026-04-28-rls-hardening.md`](./security/2026-04-28-rls-hardening.md) |

Runtime source files still outrank docs. If a doc conflicts with current code,
trust code and update the doc in the same change.

## Archived Historical Context

These documents preserve design history, but they are not current
implementation instructions:

| Archive | Why archived |
|---|---|
| [`daily-column/DESIGN.md`](./daily-column/DESIGN.md) | Original 2026-04-25 daily-column structure. It still contains retired paper-feed and older model references. Current daily prompt lives in [`../lib/llm/prompts/daily-column.md`](../lib/llm/prompts/daily-column.md). |
| [`daily-column/PLAN.md`](./daily-column/PLAN.md) | Completed implementation plan. Do not execute its checklist or recreate retired `/papers`/`papers.xml` surfaces. |
| [`daily-column/HANDOFF-2026-04-25.md`](./daily-column/HANDOFF-2026-04-25.md) | Historical voice/page iteration notes. Current voice has since been rebased; see [`HANDOFF.md`](./HANDOFF.md) and the runtime prompt. |
| [`HANDOFF-AGGREGATION.md`](./HANDOFF-AGGREGATION.md) | Root-level 2026-04-24 aggregation handoff. Historical context only; current clustering behavior lives in [`architecture/ingestion.md`](./architecture/ingestion.md). |
| [`aggregation/HANDOFF*.md`](./aggregation/) | Historical clustering sessions. Useful for rationale, not as current runbook unless [`architecture/ingestion.md`](./architecture/ingestion.md) points to it. |
| [`AGENT-MCP-PLAN.md`](./AGENT-MCP-PLAN.md) | Historical s9 bearer API/MCP design record. Current agent/API/MCP behavior lives in [`agent-access/README.md`](./agent-access/README.md), with runtime contract enums generated from [`../lib/types.ts`](../lib/types.ts). |
| [`SESSION8-PUNCHLIST.md`](./SESSION8-PUNCHLIST.md) | Old punchlist snapshot; use current code, tests, and [`HANDOFF.md`](./HANDOFF.md) instead. |

## Maintenance Rule

When changing architecture, public routes, cron behavior, LLM provider routing,
or data ownership:

1. Update the runtime code and tests.
2. Update the matching current doc above.
3. Add an archive banner to any historical doc that now contradicts current
   behavior.
