# Production R2 bootstrap receipt

- Window: `2026-07-15T04:44:33Z` to `2026-07-15T04:47:36Z`
- Release: `r0-8c1c86004a59bbcb8eed`
- Publisher run: `p-20260715044433559-f7a9a028-3b75-4e1f-8320-2905c7e471c9`
- Result: `succeeded`
- Changed: `8,730 items`, `462 events`, `55 sources`, `70 newsletters`, `1 policy`
- Immutable artifacts: `309 uploaded`, `0 reused`, `94,154,419 bytes`
- Manifest: `96,947 bytes`
- Pointer: `305 bytes`
- Run receipt: `636 bytes`
- R2 writes: `312 / 500`
- Total uploaded bytes: `94,252,307`
- Conditional bridge HTTP requests: `625`
- Total bridge upload plus readback transfer: `188,504,614 / 1,073,741,824 bytes`
- Public HTTP requests: `0`
- Bootstrap reservations: `1 / 1` (`used: 1`)
- Turso windows: `0`

The bootstrap used an ephemeral local Wrangler remote-development bridge bound
to `newsroom-public`. Every immutable write used `If-None-Match: *`; the pointer
used conditional create and was read back after commit. Every artifact and the
manifest were read back and validated before the pointer was written. The
bridge process exited after the run and no Worker deployment remains.

The production pointer resolves to manifest SHA-256
`3901d3df515fe98d7c2d2f1fbba537750f94b5c10350e214cfeb94cc1256f8b6` at
`newsroom/v1/releases/r0-8c1c86004a59bbcb8eed/manifest.json`, with no previous
release and source watermark `0`.
