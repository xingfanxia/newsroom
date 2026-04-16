import { z } from "zod";

const TAVILY_URL = "https://api.tavily.com";

const SearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string(),
  score: z.number().optional(),
  published_date: z.string().optional(),
});
export type TavilySearchResult = z.infer<typeof SearchResultSchema>;

const SearchResponseSchema = z.object({
  query: z.string(),
  results: z.array(SearchResultSchema),
  answer: z.string().optional(),
  response_time: z.number().optional(),
});
export type TavilySearchResponse = z.infer<typeof SearchResponseSchema>;

export type TavilySearchOptions = {
  query: string;
  searchDepth?: "basic" | "advanced";
  topic?: "general" | "news";
  days?: number;
  maxResults?: number;
  includeAnswer?: boolean | "basic" | "advanced";
  includeDomains?: string[];
  excludeDomains?: string[];
  timeRange?: "day" | "week" | "month" | "year";
};

export class TavilyError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "TavilyError";
  }
}

function key() {
  const k = process.env.TAVILY_API_KEY;
  if (!k) throw new TavilyError("TAVILY_API_KEY is not set");
  return k;
}

export async function tavilySearch(
  opts: TavilySearchOptions,
): Promise<TavilySearchResponse> {
  const res = await fetch(`${TAVILY_URL}/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key()}`,
    },
    body: JSON.stringify({
      query: opts.query,
      search_depth: opts.searchDepth ?? "advanced",
      topic: opts.topic ?? "news",
      days: opts.days,
      max_results: opts.maxResults ?? 6,
      include_answer: opts.includeAnswer ?? "advanced",
      include_domains: opts.includeDomains,
      exclude_domains: opts.excludeDomains,
      time_range: opts.timeRange,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new TavilyError(`tavily search failed: ${txt}`, res.status);
  }

  const json = await res.json();
  return SearchResponseSchema.parse(json);
}

const ExtractResultSchema = z.object({
  url: z.string(),
  raw_content: z.string(),
});
const ExtractResponseSchema = z.object({
  results: z.array(ExtractResultSchema),
  failed_results: z.array(z.unknown()).optional(),
});
export type TavilyExtractResult = z.infer<typeof ExtractResultSchema>;

export async function tavilyExtract(urls: string[]): Promise<TavilyExtractResult[]> {
  const res = await fetch(`${TAVILY_URL}/extract`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key()}`,
    },
    body: JSON.stringify({ urls, extract_depth: "advanced" }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new TavilyError(`tavily extract failed: ${txt}`, res.status);
  }

  const json = await res.json();
  const parsed = ExtractResponseSchema.parse(json);
  return parsed.results;
}

/**
 * Convenience: given a story title, pull short context snippets from the last 7 days.
 * Used by the enricher to ground LLM summaries with broader coverage.
 */
export async function contextForStory(
  title: string,
  opts: Partial<TavilySearchOptions> = {},
): Promise<string> {
  const r = await tavilySearch({
    query: title,
    topic: "news",
    searchDepth: "basic",
    maxResults: 5,
    days: 7,
    includeAnswer: "basic",
    ...opts,
  });
  const snippets = r.results
    .map((x) => `- ${x.title} (${x.url}): ${x.content.slice(0, 240)}`)
    .join("\n");
  return [r.answer && `answer: ${r.answer}`, snippets]
    .filter(Boolean)
    .join("\n\n");
}
