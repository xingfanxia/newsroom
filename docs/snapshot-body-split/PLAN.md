# SBS — Snapshot Body Split(blob-last 应用到 R2 公共快照布局)

> **Status: READY FOR EXECUTION** · Authored 2026-07-16 · 唯一权威执行文档
> 执行者:一个全新 agent session。本文档假设你没有任何本仓库上下文 —— 按顺序读完 §0-§3 再动手。
> 依据:2026-07-16 的 7-agent 证据审计(4 个 mapping agent 实测生产分片 + 3 个对抗审查视角)。数字都是实测,不是估算。

---

## 0. 问题与目标

news.ax0x.ai 的所有匿名读取来自 R2 公共快照(`https://content.ax0x.ai`,namespace `newsroom/v1`),由 `/api/cron/publish-public` 每 15 分钟增量发布。当前 canonical state 总量 **96 MB**,其中:

| 实体 | 分片 | 体积 |
|---|---|---|
| `state/items/*` | 128(id%128)| **94.3 MB**,其中 **bodyMd(全文/转写)= 62.7 MB(66%)** |
| `state/events/*` | 127 | 1.2 MB |
| `state/newsletters/*` | 58 | 0.6 MB |
| `state/sources` / `state/policies` | 各 1(singleton)| 0.03 MB / 184 B |

全站 **只有两个** runtime 消费者读 bodyMd(已被独立 coverage 审计确认;lexical search 只匹配 title/summary/canonicalTitle,永不碰 body):

1. `GET /api/public/items/[id]`(`lib/public-content/http.ts` → `publicItemSnapshotResult`,响应字段 `body_md`)
2. Podcast 详情页(publish 时物化的 `views/podcast-details/{00..0f}` 桶;runtime fallback 走 `page-model-builders.ts:217 → page-data.ts publicPageItemDetail`)

其余所有消费者(feed/search/events/daily/sources API、chrome、RSS、页面 fallback)都要在冷实例首触时扛全部 96 MB 的拉取+哈希+JSON.parse+zod(实测 ~6s),只为了不需要 body 的查询。实例常驻内存 ~200-400 MB。

**目标:把 bodyMd 从 `state/items/*` 拆到平行的 `bodies/items/*` 分片集(同 id%128 分区,走既有增量 patch 管线)。**

预期结果(来自实测 sizing,8,980 items):
- 全量 state:96 MB → **~32 MB**(items 去 body 30.7 + events 1.2 + sources/policies/newsletters)
- 冷实例首触:~6s → **~1.5-2s**
- 实例常驻内存:~3 倍下降(slim 索引 parsed heap 估 64-128 MB)
- item 详情:按需读 **一个 ~490 KB** 的 body 分片(62.7 MB / 128),keyed O(1)
- **所有现有消费者零代码改动自动受益**(消费者只是少扛了 62 MB)

## 0.1 排期硬约束(先检查再动手)

- **合并/部署不得早于 `2026-07-17T08:00:00Z`**。R2 cutover 的 48h 稳定性观察窗到该时刻才收口(见 `loop/STATE.md`、`docs/reports/r2-public-read/production-stability-48h-materialized-probes-2026-07-15.ndjson`)。分支上的本地开发随时可以开始;merge 前用 `date -u` 确认。
- **禁止修改** `docs/reports/r2-public-read/**` 下任何稳定性证据文件。
- 本任务 **零 Turso/DB 改动**。`db:push` 在本仓库被硬性禁止(会摧毁 `items.embedding`,无备份)——本任务根本不该碰任何 DB 命令。

---

## 1. 锁定的设计决策(D1-D9,勿重新发明)

以下决策经过对抗审查,**替代方案已被否决(§3)**。实现细节可以调整,决策本身不可以。

**D1 — 前缀在 `state/` 之外:body 分片的 logical name 为 `bodies/items/<2-hex>`。**
理由:reader 的全量聚合(`read-release.ts #readStateFromRelease`)与 publisher 的 `reconstructCanonicalState`(`build-release.ts:174`)都按 `logicalName.startsWith("state/")` 过滤 —— `bodies/` 前缀让新分片**自动**被两者排除,旧版 reader 读新 release 也不会试图把未知实体类型塞进 state(向后兼容)。`isSafeLogicalName`(`lib/public-content/paths.ts:33`)对多段路径通用,无需改动。`MAX_STATE_ARTIFACTS=800` 只数 `state/`,不受影响。

**D2 — 瘦 items 分片携带 `bodyMd: null`,不删字段。**
`contract-entities.ts:38` 已是 `bodyMd: z.string().nullable()` —— **canonicalStateSchema 零改动**。旧版应用(Vercel 回滚场景)解析新 release 的瘦分片不会报错,只是详情页 body 暂缺(降级而非损坏)。canonical hash/parity 语义不变。

**D3 — body 分片分区与 `state/items` 完全对齐:同一个 `numericBucket(entityKey, "item", 128)`(`contract-shards.ts`)。**
一条 item 变更命中的 slim 分片和 body 分片是同一个 bucket 号 —— 增量 patch 天然成对。**始终发出全部 128 个 body 分片**(空桶发 `{entities: []}`),让 reader 端"descriptor 缺失"只有一种含义:旧 release(未迁移)。

**D4 — body 分片 schema(新文件或并入 contract-shards):**
```
{ schemaVersion: 1, entityType: "item-body", entities: [{ id: number, bodyMd: string }] }
```
只收录 `bodyMd !== null` 的 item;item 删除/置空时同步从 body 分片移除。用 zod strictObject,配 `parsePublicItemBodyShardValue(logicalName, value)` 校验(镜像 `parsePublicEntityShardValue` 的做法,校验 bucket 归属:每个 id 的 `numericBucket` 必须等于分片名里的 bucket)。

**D5 — 走增量 patch 管线,不走 materialize 管线。**
`build-release.ts` 的 `groupChanges → patchEntities → buildShardArtifact` 循环(89-123 行)只加载/重写**变更**分片,内容寻址 sha 复用旧对象。body 分片必须挂进这条管线(item 类型的 change 同时驱动 slim 分片和 body 分片的 patch),**绝不**放进 `buildMaterializedPageModels` 的 delete-all-views 全量重算块。这是本设计对"派生 query-index 产物"方案的根本优势(见 §3)。

**D6 — 迁移门:镜像 `requiresNumericShardMigration` 模式。**
新增 `requiresBodySplitMigration(manifest): boolean` —— 从 manifest artifact 名推断(`bodies/items/00` 缺失 → true;**不要**给 manifestSchema(strictObject)加字段)。接进 `publish.ts` 的 noop 短路条件(~96-114 行,现有条件:`changes.length===0 && !requiresNumericShardMigration && hasRequiredMaterializedPages`)。效果:部署后第一班 publish 即使零内容变更也会全量重建 —— 从上一 release 的胖分片读出 body,拆出全部 128 个 body 分片 + 重写全部 128 个瘦 items 分片。迁移逻辑参照 build-release.ts:70-88 的 repartition 路径。

**D7 — reader 的 body 读取必须 release-pinned(禁止重新解析 pointer)。**
对抗审查证实:`readLogicalArtifact` 每次调用独立重读 `current.json`(`read-release.ts:132-142` 无 memo)—— 如果 item 详情先读 state 再独立读 body 分片,可能跨 release flip 产生 skew。实现:新增 `PublicSnapshotReader.readItemBody(release: ResolvedPublicRelease, id: number): Promise<string | null>` —— 直接从 `release.manifest.artifacts["bodies/items/<bucket>"]` 取 descriptor(内容寻址、不可变,无 skew),经 `#readArtifactBytes` 读字节(byte 缓存自动生效),解析后按 id 取值。**descriptor 缺失(旧 release)→ 返回 null,调用方回退到内联 `item.bodyMd`**。回滚阶梯(active→previous→LKG)因此一根手指不用动:详情逻辑统一为 `item.bodyMd ?? await reader.readItemBody(release, id)`。

**D8 — publish 时物化 podcast-detail 桶必须继续携带真实 body。**
`reconstructCanonicalState` 拆分后返回瘦 state → `materialize-pages.ts:107-108` 的 `publicPageItemDetailFromIndex` 会拿到 `bodyMd: null` → **播客详情页转写静默丢失**(对抗审查抓到的隐性破坏,必须有测试钉住)。修法:`buildMaterializedPageModels` 增加 body 解析入参(如 `getBody(id: number): string | null`);build-release 在调用前,从本次 `built[]` 里的新 body 分片 + 上一 release 的未变 body 分片(经 `loadArtifact`)组装 lookup。只需加载**包含 podcast item id 的 bucket**(从瘦 state 算出 podcast item id 集合 → 去重 bucket 集合),不必加载全部 128 桶。

**D9 — `/api/public/sources` 改为直读 singleton 分片(顺手项,已验证可行)。**
`publicSourcesSnapshotResult`(`http.ts:167`)只用 `snapshot.state.sources` —— 改为 `readLogicalArtifact("state/sources")` + `parsePublicEntityShardValue`,ETag 的 release sha 从 artifact 返回的 `release` 取。响应 envelope 逐字节不变(有既有 route 测试兜底)。该 route 从此冷热都 ~0.05s,连 32 MB 都不用碰。

---

## 2. 不可违反的系统不变量(改动前后都必须成立)

1. **匿名流量结构性碰不到 Turso**:`bun run verify:public-boundary` 必须过(import-graph + bundle 扫描强制)。
2. **原子 release + pointer 最后写**:immutable 对象先传先验,`current.json` CAS 收尾;发布失败不留半成品。本任务不碰 pointer 逻辑。
3. **fallback 阶梯 active→previous→LKG→受控 503**:不许出现"新产物缺失 → 503"的窗口。D7 的内联回退保证回滚到任意旧 release 时详情完整可用。
4. **公共 API 契约逐字节保持**:响应 envelope、分页、ETag family、locale 行为不变。`/api/public/items/:id` 的 `body_md` 值必须与拆分前完全一致(§SBS-6 有逐字节 diff 验收)。
5. **publisher O(changed) 增量**:稳态 tick 只重写变更 bucket 的 slim+body 分片;唯一的全量重建是 D6 迁移那一班。
6. **发布物白名单**:embeddings、LLM 原始 reasoning、raw RSS body、token、私有笔记等永不入 R2 —— 本任务只搬运既有的 `bodyMd`,不新增暴露面。

## 3. 已否决的替代方案(执行中不得"优化"回去)

| 方案 | 否决理由(对抗审查结论) |
|---|---|
| 新增派生 `views/query-index`(30 MB 单 blob) | 与瘦身后的 canonical state 近乎重复;任何一条 item 变更翻转整 blob sha → 每 15 分钟重传 30 MB;叠加在已知的 GC 缺口上(retention.ts 只算 deleteReleaseIds,无代码真的删对象);走 delete-all-views 全量重算管线 |
| item 详情全量搬进 `views/` 物化桶 | `state/items` 本来就是 id%128 增量分片 —— 再造一份同分区的拷贝却走每班全量重算的贵管线;单一全量 detail 产物 94 MB 还超 `ARTIFACT_MAX_BYTES=64MB` |
| 热 30 天 / 归档拆分 | `publicEventMembersFromIndex` 对缺失 id 静默 `.filter` 丢弃(无报错)→ 老成员静默消失;feed 的 "all-time fully paginable" 是文档硬契约;归档占 slim 的 81%(24.9/30.7 MB),拆了也省不了多少 |
| 公共 API 回 Turso + 缓存 | 整套 R2 系统的存在理由就是匿名流量结构性无法触达 Turso(2026-07 实测 ~590M rows/月、超免费额 6 倍后的架构转向);缓存 miss 路径永远存在 |
| runtime 侧"绝不读 canonical state"的绝对化目标 | 迁移/回滚窗口会产生全站 503(`read-release.ts:78-79`:active 缺 artifact → 直接 null,不试 previous/LKG)。本设计保留 readCanonicalState 作为 runtime 路径,只是让它轻 3 倍 |

## 4. 执行阶段(每阶段:TDD 先红后绿 → 实现 → code-reviewer 多轮 → 修完全部 findings → 一个 conventional commit → 更新 §7 表格)

### SBS-1 · contracts:body 分片 schema + logical name + 迁移谓词
- 新增 body 分片 zod schema + `parsePublicItemBodyShardValue`(D4;放 `lib/public-content/contract-shards.ts` 或紧邻新文件,从 `contracts.ts` 桶文件导出)
- `publicItemBodyShardLogicalName(entityKey): "bodies/items/<2hex>"`,复用 `numericBucket`(D3)
- `requiresBodySplitMigration(manifest)`(D6;放 build-release.ts,镜像 `requiresNumericShardMigration`)
- 测试:bucket 归属校验拒绝错桶 id;空桶合法;非法 shape 拒绝;迁移谓词对有/无 `bodies/items/00` 的 manifest 判断正确
- 验收:`bun run test` 绿(注意:**永远用 `bun run test`,不要裸 `bun test`** —— 裸命令会误扫 `tmp/` 下的旧脚本)

### SBS-2 · publisher:拆分构建 + 增量 patch + 迁移 + 物化 body 线程
- `build-release.ts`:item 分片构建时剥离 body(slim 分片 `bodyMd: null`)+ 同 bucket body 分片 patch(D5);迁移分支(D6,参照 70-88 行 repartition);全部 128 body 分片始终在 manifest(D3)
- `publish.ts`:noop 条件加 `!requiresBodySplitMigration`;`uploadChangedReleaseArtifacts`(211-250 行)为 `bodies/` 前缀加校验分支(用 `parsePublicItemBodyShardValue`)
- `materialize-pages.ts`:`getBody` 入参线程(D8)
- 测试(publisher.test.ts / build-release 相关):
  - 一条 item 变更 → 恰好该 bucket 的 slim+body 两个分片重建,其余 sha 复用(`unchanged`)
  - item 的 body 置空/item 删除 → body 分片同步移除该 id
  - 迁移:胖分片旧 release + 零变更 → 强制重建,产出全部 128 body 分片 + 全瘦 items 分片,canonical state(内联 null)与拆分前 state 除 bodyMd 外逐字段相等
  - **podcast-detail 桶在拆分后仍携带非空 bodyMd**(D8 回归钉子)
- 验收:`bun run test` 绿

### SBS-3 · reader:release-pinned body 读取
- `read-release.ts`:`readItemBody(release, id)`(D7)。不要动 `#readStateFromRelease` 的 `state/` 过滤(D1 已保证排除)
- 测试(tests/public-content/reader.test.ts,fixture 用 `contract-fixtures.ts` 扩展):
  - 新 release:slim state 聚合不含 body;`readItemBody` 返回正确 body;无 body 的 id 返回 null
  - 旧 release(无 bodies artifact):`readItemBody` 返回 null(不抛)
  - pinned 语义:body 读取不重新解析 pointer(可用 fetch 计数或 pointer flip 场景断言)
  - 字节完整性失败 → 抛(descriptor sha 校验既有行为)
- 验收:`bun run test` 绿

### SBS-4 · 消费者:item API + podcast 详情 fallback
- `http.ts publicItemSnapshotResult` → async,`body_md = item.bodyMd ?? await reader.readItemBody(snapshot.release, id)`;route(`app/api/public/items/[id]/route.ts`)适配
- `page-data.ts publicPageItemDetail(FromIndex)` 加 body 解析参数;`page-model-builders.ts:217`(podcast 详情 fallback)与 materialize-pages 两个调用方适配
- 测试:item API 对(a)新 release 拆分 body(b)旧 release 内联 body(c)无 body item,三种情况 `body_md` 正确;ETag signal 不变;podcast 详情 fallback 路径拿到 body
- 验收:`bun run test` 绿 + `bun run verify:public-boundary` 绿

### SBS-5 · sources 直读(D9)
- `http.ts publicSourcesSnapshotResult` 改造 + route 适配;既有 sources route 测试必须不改断言直接过(envelope 逐字节)
- 验收:`bun run test` 绿

### SBS-6 · 全量验证 + PR + 合并 + 生产迁移验证
1. `bun run verify` → 必须输出 `HERMETIC_VERIFY_COMPLETE`(7 stages:typecheck/lint 0-warn/build/knip×3/hermetic tests)
2. **合并前基线采集**:`/usr/bin/curl -s "https://news.ax0x.ai/api/public/items/<挑一个有 body 的 id>"` 存下响应(拿 `body_md` 做迁移后 diff 基线);再记录当前 release 的 state 总字节(从 `https://content.ax0x.ai/newsroom/v1/current.json` → manifest 汇总 `state/*` byteLength)
3. 开 PR(标题 `perf(public-content): split item bodies out of state shards (SBS)`,body 记录 Autonomous decisions)→ CI 绿 → **确认 `date -u` ≥ 2026-07-17T08:00:00Z 后**合并
4. 等下一班 publish(:12/:27/:42/:57)+ 一次 Vercel 部署完成,然后验证(全部证据贴进 transcript):
   - 新 release manifest 含 128 个 `bodies/items/*` artifact,且 `state/*` byteLength 总和 **< 45 MB**(贴数字)
   - 迁移前存的那个 item:`body_md` 与基线**逐字节一致**(diff 为空)
   - 延迟探测:`/api/public/feed?limit=5`、`/api/public/items/<id>`、`/api/public/sources` 各 3 发,暖请求 < 0.5s;若能观测到冷实例首发,应 < 3s(冷首发受 Vercel 调度影响,不作硬门,但要贴出数字)
   - 再等一班 publish 确认稳态增量:第二班 manifest 里绝大多数 body 分片 sha 与第一班相同(贴 reused 计数或抽样对比)
5. 更新 `docs/operations/public-snapshots.md` 的分片布局章节(in-flight 知识同步,与代码同 PR)
6. 更新本文件 §7 全部 done + 收尾(neat-freak 检查)

## 5. 风险与预案

| 风险 | 预案 |
|---|---|
| 迁移班 publish 内存/时长(重写 128+128 分片 ≈ 95 MB 构建物,叠加 reconstruct 的 32 MB state) | bootstrap 曾在同量级(95 MB)成功;maxDuration=300s,实测全量物化 60.9s。若本地模拟显示逼近上限:分两班(先 body 分片后 slim)或临时调 memory,**先测再调** |
| 每班物化 podcast 桶需加载 body 分片 | 只加载含 podcast id 的 bucket(D8);podcast items 416 个,R2 GET 便宜,16 路并发几秒内完成 |
| 旧应用回滚读新 release | D2:瘦分片 `bodyMd: null` 合法解析;详情降级无 body,不崩(可接受的回滚窗口行为,已知且记录) |
| 新应用读旧 release(pointer 回滚) | D7:body artifact 缺失 → 内联回退,行为与拆分前完全一致 |
| `.slice()` 每次调用复制 body 分片字节(~490 KB) | 每请求一次,可接受;不做过早优化(对抗审查确认这只在 30 MB 级别才是问题) |
| GC 缺口(retention 不删对象)导致存储增长 | 既有债务,本设计因增量 sha 复用**不放大**它;不在本任务修,在 §6 记录 |

## 6. 明确不做(follow-ups,勿 scope-creep)

- RSS publish 时预渲染({xml} 包装 + rss-http 消费)——低风险但独立;拆分后 RSS 冷路径已随 slim state 降到 ~2s
- daily/dailies API 复用 `views/daily` 物化产物 —— 同上
- R2 对象 GC(消费 `deleteReleaseIds` 真删)—— 既有债务,独立任务
- W8/W9 legacy DB 缓存清理 —— 属 R2 cutover 计划 P5,等其自身收口流程
- reader 对 body 分片的 parsed memo —— 无证据需要

## 7. 阶段状态表(每阶段 commit 后更新)

| Phase | 内容 | 状态 | Commit |
|---|---|---|---|
| SBS-1 | contracts + 迁移谓词 | done | `perf(public-content): add item body shard contracts` |
| SBS-2 | publisher 拆分/patch/迁移/物化线程 | done | `perf(public-content): split bodies in snapshot publisher` |
| SBS-3 | reader release-pinned body 读取 | done | `perf(public-content): add release-pinned body reads` |
| SBS-4 | item API + podcast 详情消费者 | done | `perf(public-content): hydrate split bodies for consumers` |
| SBS-5 | sources 直读 | done | `perf(public-content): read sources shard directly` |
| SBS-6 | verify + PR + merge + 生产迁移验证 | pending | |

## 8. 关键文件地图(行号为 2026-07-16 快照,可能漂移,以符号为准)

- `lib/public-content/contract-entities.ts:38` — `bodyMd: z.string().nullable()`
- `lib/public-content/contract-shards.ts` — `publicEntityShardLogicalName` / `numericBucket` / `parsePublicEntityShardValue`(镜像模板)
- `lib/public-content/publisher/build-release.ts` — 70-88 repartition 迁移模板;89-123 增量 patch 循环;125-147 物化块;174 `reconstructCanonicalState`(`state/` 过滤);383 `requiresNumericShardMigration`(迁移谓词模板);424 `groupChanges`
- `lib/public-content/publisher/publish.ts` — 96-114 noop 短路;211-250 上传+按前缀校验
- `lib/public-content/publisher/materialize-pages.ts:93-125` — podcast-detail 桶构建(D8 改造点)
- `lib/public-content/reader/read-release.ts` — 30-56 缓存字段;77 `readLogicalArtifact`;110 `readCanonicalState`;132 `#candidateReleases`(每次重读 pointer —— D7 的动机);196 `#readArtifactBytes`(内容寻址字节缓存);246 `#readStateFromRelease`(`state/` 过滤)
- `lib/public-content/http.ts` — 167 `publicSourcesSnapshotResult`(SBS-5);232 `publicItemSnapshotResult`(SBS-4)
- `lib/public-content/page-data.ts:38-67` — `publicPageItemDetail(FromIndex)`(SBS-4)
- `lib/public-content/page-model-builders.ts:217` — podcast 详情 fallback 调用点
- `tests/public-content/contract-fixtures.ts` — fixture 工厂;`tests/public-content/{reader,publisher,contracts}.test.ts`
- 验证命令:`bun run verify`(7 stages,终态标记 `HERMETIC_VERIFY_COMPLETE`)、`bun run verify:public-boundary`、`bun run test`
