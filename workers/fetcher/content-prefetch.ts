import {
  runArticleBodyFetch,
  type ArticleBodyReport,
} from "@/workers/fetcher/article-body";
import {
  runYoutubeTranscriptFetch,
  type YoutubeTranscriptReport,
} from "@/workers/fetcher/youtube-transcript";

export type ContentPrefetchReport = {
  articleBody: ArticleBodyReport;
  youtubeTranscript: YoutubeTranscriptReport;
};

export async function runContentPrefetch(): Promise<ContentPrefetchReport> {
  const [articleBody, youtubeTranscript] = await Promise.all([
    runArticleBodyFetch(),
    runYoutubeTranscriptFetch(),
  ]);
  return { articleBody, youtubeTranscript };
}
