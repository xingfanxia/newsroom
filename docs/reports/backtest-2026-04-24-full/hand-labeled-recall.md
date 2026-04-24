# Hand-labeled recall test

**Operator instructions:** list 20 pairs of items you _know_ should be in the same event (e.g. OpenAI release covered by both their blog and HN, GPT-5 launch covered by Bloomberg and TechCrunch). Use `item.id` from the production DB.

Then run:
```bash
bun --env-file=.env.local scripts/ops/backtest-recall-check.ts \\
  --pairs hand-labeled-recall.md
```

(That secondary script does not exist yet — write it after this template is filled. It just queries each pair, computes their cosine distance, and reports merge-or-not under `--threshold`.)

## Pairs

<!-- Format: `a_id, b_id, # description` -->

| a_id | b_id | Description |
|---|---|---|
| ? | ? | (example) GPT-5 launch — OpenAI blog + HN frontpage |
| ? | ? | (example) Anthropic funding — TechCrunch + Bloomberg |

**Gate:** ≥ 16/20 of the listed pairs must be `merged` under the configured threshold.
