# Production Vercel cutover — 2026-07-15

- Run: `production-vercel-cutover-20260715t051149z`
- Previous production deployment: `dpl_CzkjVD8GwsiX5HhhZd7LTxWdL91h`
- New production deployment: `dpl_6K4t8Zy9fDLJuJJAdt9xnPQEXSHL`
- Deployment URL: `newsroom-8w3zc1lb1-panpanmao.vercel.app`
- Production origin: `https://news.ax0x.ai`
- Cutover result: succeeded; rollback was not required

The protected preview canary first passed representative HTML, RSC, JSON, and
RSS requests on deployment `dpl_2Lmw4rcCwASKHrQSWQRsucUFdTxj`. Production was
then built with the production environment and aliased to the new deployment.

Immediate post-cutover probes all returned HTTP 200:

| Surface | Path | Content type | Bytes |
| --- | --- | --- | ---: |
| HTML | `/en` | `text/html` | 307,434 |
| RSC | `/en?_rsc=cutover` | `text/x-component` | 173 |
| JSON | `/api/public/feed?locale=en&limit=10` | `application/json` | 10,511 |
| RSS | `/api/feed/en/rss.xml` | `application/rss+xml` | 139,762 |

The HTML marker, non-empty RSC payload, ten-item JSON envelope, and RSS marker
were validated. Total response bodies were 457,880 bytes across four requests,
within the pre-registered 10-request / 10-MiB budget. No Turso window or R2
write was consumed by this probe.
