# AC-004 production pointer preflight — 2026-07-15

Read-only public-domain observation; this is not an AC-004 pass receipt.

```text
captured_at: 2026-07-15T01:14:46Z
method: HEAD
url: https://content.ax0x.ai/newsroom/v1/current.json
status: 404
content-type: text/html
server: cloudflare
cf-cache-status: MISS
response_body_bytes: 0
```

Interpretation: the custom domain is reachable, but the production release
pointer does not exist. The outbox migration, one-time bootstrap, deployment,
cutover, cache proof, and subsequent load/budget receipts remain externally
gated. No token, database access, R2 write, cache mutation, or redirect was used.
