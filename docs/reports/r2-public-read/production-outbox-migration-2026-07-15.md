# Production outbox migration receipt

- Window: `2026-07-15T04:24:24Z` to `2026-07-15T04:24:26Z`
- Database: `newsroom-v2`
- Migration: `20260714_public_content_outbox_v1`
- Checksum: `10137a90e335ad8ae8e62e47df1b5e7e5b99c73a811d3ef897ce301eea946bfe`
- Result: `applied: true`
- Turso usage API rows read: `614852565` to `614852565` (`delta: 0`)
- Turso usage API rows written: `4304222` to `4304222` (`delta: 0`)
- R2 writes: `0`
- Public HTTP requests: `0`
- Bootstrap reservations: `0`

The operator used a one-hour database-scoped token created in-process from the
existing local Turso platform credential. No database token, URL, authorization
header, or environment file was persisted in this receipt or the repository.
