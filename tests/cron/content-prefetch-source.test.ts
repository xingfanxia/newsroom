import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const helperPath = resolve(root, "workers/fetcher/content-prefetch.ts");
const routePath = resolve(root, "app/api/cron/article-body/route.ts");
const scriptPath = resolve(root, "scripts/ops/run-cron.ts");

describe("content prefetch cron wiring", () => {
  it("centralizes article body + YouTube transcript prefetch in a worker helper", () => {
    expect(existsSync(helperPath)).toBe(true);
    const helper = readFileSync(helperPath, "utf8");

    expect(helper).toContain("runContentPrefetch");
    expect(helper).toContain("runArticleBodyFetch");
    expect(helper).toContain("runYoutubeTranscriptFetch");
    expect(helper).toContain("Promise.all");
    expect(helper).toContain("return { articleBody, youtubeTranscript }");
  });

  it("keeps the HTTP article-body cron route on the shared prefetch helper", () => {
    const src = readFileSync(routePath, "utf8");

    expect(src).toContain("runContentPrefetch");
    expect(src).toContain("articleBody: report.articleBody");
    expect(src).toContain("youtubeTranscript: report.youtubeTranscript");
    expect(src).not.toContain("runArticleBodyFetch");
    expect(src).not.toContain("runYoutubeTranscriptFetch");
  });

  it("keeps the local body bucket on the production prefetch path", () => {
    const src = readFileSync(scriptPath, "utf8");

    expect(src).toContain("runContentPrefetch");
    expect(src).toContain('"article-body": contentPrefetch');
    expect(src).toContain('body: "article-body"');
    expect(src).not.toContain("runArticleBodyFetch()");
  });
});
