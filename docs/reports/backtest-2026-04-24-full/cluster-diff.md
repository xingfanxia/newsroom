# Cluster diff — backtest

**Run:** 2026-04-24T23:00:27.384Z  
**Window:** ±72h, **Threshold:** 0.8, **Since:** 2026-01-01

## Population in window

| Metric | Count |
|---|---|
| total items | 7837 |
| embedded | 7819 |
| currently clustered | 7816 |
| current clusters | 7816 |

## New-merge pairs under tuned params

**Total new-merge pairs:** 573

These are pairs of items that are NOT in the same cluster today but would merge under threshold 0.8 / window ±72h.

### Distance distribution

| Distance bucket | Pairs |
|---|---|
| 0.00-0.05 | 104 |
| 0.05-0.10 | 136 |
| 0.10-0.15 | 134 |
| 0.15-0.20 | 199 |
| >0.20 | 0 |

### Source-of-merge breakdown

| Type | Count | Note |
|---|---|---|
| cross-source | 368 | high-value: event coverage across publishers |
| same-source | 205 | usually near-duplicates from the same feed |

## Interpretation

- Cross-source ratio of ≥ 50% means the threshold is catching real cross-publisher event signal.
- If same-source > 2× cross-source, threshold may be too loose; try `--threshold 0.82`.
- See `spot-check-sample.md` for a randomized eyeball check.
