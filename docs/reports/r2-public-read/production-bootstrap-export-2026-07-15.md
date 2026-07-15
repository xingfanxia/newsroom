# Production bootstrap export receipt

- Window: `2026-07-15T04:34:38Z` to `2026-07-15T04:37:40Z`
- Source watermark: `0`
- Canonical state SHA-256: `ea6036d17022e3c04febe0b542adc6eef09e9928aa902f519766d30f240442ed`
- Output bytes: `94,124,402`
- Output mode: `0600`
- Counts: `8,730 items`, `462 events`, `55 sources`, `70 newsletters`, `1 policy`
- Export telemetry: `81 queries`, `37,358 returned rows`
- Turso rows read: `615049007` to `615114307` (`delta: 65,300`)
- Turso rows written: `4305154` to `4305154` (`delta: 0`)
- R2 writes: `0`
- Bootstrap reservations: `0`

The strict public contract rejected one disabled historical source locator on
the first captured attempt. The source was confirmed as
`x-ai-watchlist -> internal://x-watchlist`, already documented as a retained
disabled historical row, and was added as one exact allowlist pair. Arbitrary
internal locators remain rejected.

A local release prebuild after changing the unpublished numeric shard count
from 256 to 128 produced release `r0-8c1c86004a59bbcb8eed`: 309 artifacts,
94,154,419 artifact bytes, a 96,947-byte manifest, a largest shard of 923,637
bytes, and 312 total expected R2 writes including manifest, pointer, and run
receipt. This is below the immutable 500-write bootstrap cap.
