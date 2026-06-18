# AI HOT Integration + Voice Rebase — PLAN

> **Historical archive.** This shipped 2026-05-08 AI HOT integration and voice
> rebase plan is not current implementation guidance. Current runtime behavior
> lives in [`../architecture/ingestion.md`](../architecture/ingestion.md) and
> the runtime source files remain authoritative.

**Status**: shipped. This document is retained as the design record for the
2026-05-08 AI HOT integration and voice rebase; current runtime behavior is
implemented in `lib/sources/aihot.ts`, `workers/fetcher/aihot.ts`, and
`workers/newsletter/aihot-daily.ts`.
**Tier**: 4 (schema + cross-cutting voice change + LLM full backfill).
**Engine**: superpowers cycle, wave-based parallel implementation.

---

## 1. Why

User wants:
1. AI HOT (https://aihot.virxact.com) integrated as a new source — selected pool ingested as our items, daily report merged into our `/daily` column.
2. Voice rebase: current "AI 味太浓" — daily column on **虎嗅周报** voice; enrich + commentary on **晚点骨架**. Re-allocate by content shape:
   - **Daily column narrative**: → khazix narrative (口语化, 私人视角, 句式断裂, 文化升维, 5000-8000 字).
   - **Item summary_zh / summary_en**: stay 晚点骨架 (120-220 字, short-sharp).
   - **editor_note_zh / editor_note_en** (1-2 sentences): stay terse 晚点-style.
   - **editor_analysis_zh / editor_analysis_en** (long-form 深度解读): → khazix-narrative *compressed* (300-500 字, one judgment per paragraph, no meta-commentary openers, no repeated disclosures, no list-disguised-as-prose). See `~/.claude/projects/<...>/memory/feedback_voice_editor_analysis.md` for the anti-pattern catalog. **Superseded 2026-05-08 (PR #35)**: rebranded to 锐评, hard cap 200 字, 1-2 段 single judgment. See `docs/architecture/ingestion.md` § 6 deviations entry.
3. Backfill: re-enrich all historical items + clusters with new prompts. Cost-aware (dry-run first, --max-cost-usd ceiling, idempotent).

## 2. Scope

### In
- `aihot-api` source kind end-to-end (client → fetcher → catalog → schema enum)
- `aihot-selected` source registered, hourly cadence, `curated=true`, `neverExclude=true`
- AI HOT daily payload cached on newsletters table (additive cols)
- daily column generator must-cover injection: every lead + section.items entry from AI HOT's daily must appear in our narrative
- 4 prompt files rewritten per voice allocation above
- `editorial.skill.md` policy bumped (auto-reload on next enrich)
- L1-L4 column self-check rules updated for khazix
- Backfill scripts: re-enrich + AI HOT history import (180-day cap)
- Tests: API client, fetcher adapter, daily fetch, must-cover assertion

### Out
- New UI design (reuse existing `/daily` page chrome; add only attribution chip)
- AI HOT bot detection beyond UA + 600 req/min awareness
- English daily column (still zh-only per prior design decision)
- Per-source RSS feeds for AI HOT (not requested)
- AI HOT mode=all ingestion (priority 3, deferred — selected pool covers user need)

## 3. Architecture

### 3.1 Why API over RSS

AI HOT's `/api/public/daily` returns structured `{ lead, sections[5 fixed labels], flashes[] }`. RSS only gives flat 50-item feed. "完整包括他的日报" requires sections structure → API. Also need `mode=selected` filter, time-window queries, and `/dailies?take=180` for backfill — all API-only.

### 3.2 Source kind: aihot-api (not generic api)

Add explicit `aihot-api` kind to `source_kind` enum. Reasons:
- Generic `api` is reserved (catalog already has it for HF trending — currently disabled, future use).
- Distinct kind = clean `SUPPORTED_KINDS` dispatch in fetcher, no special-case branching by URL prefix.
- Schema migration is **additive** (just add enum value), no risk to existing rows.

### 3.3 Daily merge model

Single newsletter row per (kind=daily, locale=zh, period_start). Two new columns capture AI HOT input:

```
aihot_daily_payload  jsonb     -- full /daily response, frozen
aihot_daily_date     date      -- which AI HOT date got merged in
```

Generator flow:
```
runDailyColumn(now)
  → selectDailyColumnPool(now)  [our 严选 + 热点 union, unchanged]
  → fetchAihotDailyForWindow(date(now))  [graceful: null on failure]
  → renderItemsForPrompt(pool, aihotDaily)  [includes <aihot-daily> block]
  → generateStructured(...)  [prompt enforces must-cover]
  → upsert newsletters with aihot_daily_payload + aihot_daily_date persisted
```

If AI HOT API is down: `aihotDaily = null`, narrative just covers our pool. Our daily ships regardless.

### 3.4 Voice allocation by content shape

| Field | Voice | Length | File |
|---|---|---|---|
| `column_title` | khazix concrete-title | ≤24 字 | `lib/llm/prompts/daily-column.md` |
| `column_summary_md` (开场白) | khazix conversational | 100-200 字 | same |
| `column_narrative_md` | khazix 长文体 + 数字小节 | 5000-8000 字, 6-10 节 | same |
| `summary_zh` / `summary_en` | 晚点骨架 (unchanged) | 120-220 字 | `workers/enrich/prompt.ts` enrichSchema |
| `editor_note_zh` / `editor_note_en` | terse 晚点 (unchanged) | 1-2 句, ≤160 字 | `workers/enrich/prompt.ts` commentarySchema |
| `editor_analysis_zh` / `editor_analysis_en` | **khazix-compressed** (NEW) | **300-500 字, 3-6 段, each 3-5 句** | `workers/enrich/prompt.ts` commentarySchema + `workers/cluster/commentary.ts` |

**Editor-analysis hard rules (the new "AI HOT 短锐 deep-dive" voice)**:
- 一段一个判断
- 不要 meta-commentary 开头：✗ `我的判断是` / `先把缺口摆明` / `拿外部参照看` / `我有一个比较大的疑虑` → ✓ 直接给判断
- 不重复披露：`正文未披露` / `本文未披露` 整篇 ≤ 2 次（首段一次足够）
- 不要列点伪装成 prose：✗ "中间还隔着 A、B、C、D 四道坎" → ✓ 选最强一条说，或拆段
- 删冗余修饰：✗ "现在被用户感知到的核心能力" → ✓ "当前能力"
- 收尾不总结，最后一句锐评或自然停在最后判断

### 3.5 Fetcher cadence

`aihot-selected` runs in existing **hourly** bucket (cadence='hourly' in source row → `runFetchBucket(['hourly'])` picks it up). Daily AI HOT report fetched separately by `runDailyColumn` cron — not via the source-fetcher path because the daily payload is a single resource cached on the newsletter row, not a stream of items.

## 4. Wave plan

```
Wave 1 (parallel, no deps):
  A1 API client          C1 daily-column.md → khazix
  A2 schema enum         C2 enrich prompt → editor_analysis section khazix-compressed
  B1 newsletter columns  C3 cluster commentary same rebase
                         C4 editorial.skill.md policy bump

Wave 2 (after Wave 1):
  A3 fetcher adapter (needs A1, A2)
  A4 catalog entry (needs A2)
  B2 daily fetch worker (needs A1, B1)
  D2 history import (needs A1, B1)
  E2 L1-L4 self-check update (needs C1)

Wave 3 (after Wave 2):
  B3 generator must-cover injection (needs B2, C1)
  B4 UI attribution chip (needs B1)

Wave 4 (after Wave 3):
  D1 backfill-style script (needs C2, C3, C4)
  E1 tests (needs A1, A3, B2, B3)

Wave 5 (final):
  E3 cron + env + verify
```

## 5. Acceptance criteria

- [ ] `bun run build` green
- [ ] `bun test` green (existing + new tests)
- [ ] `bun run lint` green
- [ ] `bun scripts/ops/backfill-style.ts --dry-run` prints accurate cost forecast
- [ ] Manual: hit `/zh/daily` locally with seeded AI HOT payload, verify attribution chip + must-cover narrative
- [ ] Manual: 5 fixture days passed through new daily-column prompt, manually graded for khazix voice
- [ ] Manual: 5 historical featured items re-enriched, editor_analysis output verified ≤ 500 字, 3-6 段, no meta-commentary openers, no doubled-disclosure
- [ ] Schema migration applied cleanly via `bun db:push --force` on dev, no data loss
- [ ] `column_qc_log` rows show L1-L4 pass for first 3 daily column runs after deploy

## 6. Rollback

- Schema: enum additions are additive — no rollback needed; old rows continue to work
- Voice: revert prompt commits → `editorial.skill.md` policy version unbumped; workers pick up old prompt automatically
- Backfill: idempotent + cursor-resumable, safe to re-run
- AI HOT outage: `aihotDaily = null` path keeps daily column shipping; attribution chip hidden when `aihot_daily_date IS NULL`

## 7. Cost estimate (rough)

- Items table count: query DB (TBD during D1 dry-run)
- Per-item enrich (summary + analysis): ~3000 tokens in + 1500 out at GPT-5.4 standard rates ≈ $0.012 per item
- 1000 items = $12, 5000 items = $60
- Will run `--dry-run` first, decide batch size based on actual count. Hard cap `--max-cost-usd 50` by default.

## 8. References

- Discovery / handoff: `docs/aggregation/HANDOFF-2026-04-28-pipeline-recovery.md`
- Daily column original design: `docs/daily-column/DESIGN.md`
- Editorial policy current: `modules/feed/runtime/policy/skills/editorial.skill.md`
- Voice memory: `~/.claude/projects/<...>/memory/feedback_voice_editor_analysis.md`
- AI HOT API: https://aihot.virxact.com/openapi.yaml
