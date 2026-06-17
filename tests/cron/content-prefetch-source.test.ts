import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { readSource, sourcePath } from "@/tests/helpers/source";

const helperPath = "workers/fetcher/content-prefetch.ts";
const routePath = "app/api/cron/article-body/route.ts";
const scriptPath = "scripts/ops/run-cron.ts";

describe("content prefetch cron wiring", () => {
  it("centralizes article body + YouTube transcript prefetch in a worker helper", () => {
    expect(existsSync(sourcePath(helperPath))).toBe(true);
    const helper = readSource(helperPath);

    expect(helper).toContain("runContentPrefetch");
    expect(helper).toContain("runArticleBodyFetch");
    expect(helper).toContain("runYoutubeTranscriptFetch");
    expect(helper).toContain("Promise.all");
    expect(helper).toContain("return { articleBody, youtubeTranscript }");
  });

  it("keeps content URL ownership rules in the shared media helper", () => {
    const mediaHelper = readSource("lib/urls/media.ts");
    const articleBody = readSource("workers/fetcher/article-body.ts");
    const youtubeTranscript = readSource("workers/fetcher/youtube-transcript.ts");

    expect(mediaHelper).toContain("articleBodyFetchUrlSql");
    expect(mediaHelper).toContain("youtubeVideoUrlSql");
    expect(mediaHelper).toContain("xStatusUrlSql");
    expect(mediaHelper).toContain("enrichBodyPrefetchReadySql");
    expect(articleBody).toContain("@/lib/urls/media");
    expect(articleBody).toContain("articleBodyFetchUrlSql(items.canonicalUrl)");
    expect(articleBody).toContain("isYouTubeVideoUrl(target)");
    expect(youtubeTranscript).toContain("@/lib/urls/media");
    expect(youtubeTranscript).toContain("youtubeVideoUrlSql(items.canonicalUrl)");
    expect(youtubeTranscript).toContain("extractYouTubeId(");
    expect(articleBody).not.toContain("NOT LIKE '%youtube.com/watch%'");
    expect(articleBody).not.toContain("NOT LIKE '%x.com/%/status/%'");
    expect(youtubeTranscript).not.toContain("LIKE '%youtube.com/watch%'");
  });

  it("keeps the HTTP article-body cron route on the shared prefetch helper", () => {
    const src = readSource(routePath);

    expect(src).toContain("runContentPrefetch");
    expect(src).toContain("runCronJsonRoute");
    expect(src).toContain("articleBody: report.articleBody");
    expect(src).toContain("youtubeTranscript: report.youtubeTranscript");
    expect(src).not.toContain("verifyCron(");
    expect(src).not.toContain("NextResponse");
    expect(src).not.toContain("runArticleBodyFetch");
    expect(src).not.toContain("runYoutubeTranscriptFetch");
  });

  it("keeps the local body bucket on the production prefetch path", () => {
    const src = readSource(scriptPath);

    expect(src).toContain("runContentPrefetch");
    expect(src).toContain('"article-body": contentPrefetch');
    expect(src).toContain('body: "article-body"');
    expect(src).not.toContain("runArticleBodyFetch()");
  });
});
