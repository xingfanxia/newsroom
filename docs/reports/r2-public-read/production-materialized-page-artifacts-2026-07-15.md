# Production materialized page artifacts — 2026-07-15

## Outcome

Production anonymous pages no longer reconstruct the 95.1 MB canonical R2
snapshot. The publisher cron derives immutable serving artifacts and advances
the same atomic release pointer. Runtime pages read one route artifact; podcast
details read one of 16 ID buckets covering all 416 current podcast items.

- Main SHA: `4ca3aa7e7363df23bb96ec67d863de79f568a12e`
- Production deployment: `dpl_H7eQJG3TxfaVT4EwffzpZD15xPnt`
- Active release: `r457-28ad1215f3a0fd05dbc7`
- Serving views: 30 immutable artifacts
- Canonical archive: 313 state artifacts, retained for publication and rollback
- Bootstrap runs: 0
- Unexpected production 5xx: 0

## Production performance

Repeated sequential TTFB after the final deployment:

| Route | TTFB |
| --- | ---: |
| `/en` | 0.24–0.63 s |
| `/en/all` | 0.28–0.36 s |
| `/en/curated` | 0.28–0.36 s |
| `/en/podcasts/4` and `/zh/podcasts/4` | 0.27–0.35 s |

An eight-way cold parallel pass returned every route with HTTP 200 and ranged
from 0.27 to 2.51 seconds. The earlier request-time canonical path measured
roughly 7–15 seconds on cold fills.

## Publisher evidence

The first materialization published 95 changed objects (6.75 MB) in 60.9
seconds. The final all-detail bucket migration published 16 objects (5.27 MB),
reused 14, and completed in 28.8 seconds. Both runs were pointer-last,
successful, and did not consume the one-time bootstrap.

The publisher now owns the full-state read and derivation cost. Anonymous
traffic has no Turso fallback and does not scale Turso rows-read.
