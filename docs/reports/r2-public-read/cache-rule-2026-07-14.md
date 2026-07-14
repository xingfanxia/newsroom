# Cloudflare R2 Cache Rule Receipt

Recorded: `2026-07-14T11:53:46Z`  
Zone: `ax0x.ai` (`ecb96aac3c5c24e596d31aef3c609524`)  
Host: `content.ax0x.ai`  
Bucket: `newsroom-public`

## Rule

- Ruleset: `f709b41f3e5342518195613937030b4e`
- Rule: `c22b26eacb0648878acfa663a4f080ee`
- Ref: `newsroom_r2_snapshots_cache`
- Phase: `http_request_cache_settings`
- Match:
  `(http.host eq "content.ax0x.ai" and starts_with(http.request.uri.path, "/newsroom/"))`
- Action: `set_cache_settings`
- Cache eligibility: enabled
- Edge TTL: `respect_origin`
- Browser TTL: `respect_origin`

The rule does not match the rest of `ax0x.ai` and stores no runtime credential.

## Expected-red control

Before the rule, JSON at the custom domain returned
`CF-Cache-Status: DYNAMIC` despite a public Cache-Control header.

## Verification

Requests used the same `Origin: https://news.ax0x.ai` variant because the R2
response correctly includes `Vary: Origin`.

| Probe | Origin Cache-Control | First | Repeat | Later Age | Other checks |
|---|---|---|---|---:|---|
| pointer-like JSON | `public,max-age=60,stale-while-revalidate=300` | `MISS` | `HIT` | 22 | 200, CORS `*`, ETag stable |
| immutable JSON | `public,max-age=31536000,immutable` | `MISS` | `HIT` | 22 | 200, CORS `*`, ETag stable |

Both responses preserved their distinct origin Cache-Control headers after the
rule's browser TTL was explicitly set to `respect_origin`. AC-004 remains OPEN
until the real `current.json` and immutable release artifacts repeat this proof
after publisher implementation.

No API token or authorization header is stored in this receipt.
