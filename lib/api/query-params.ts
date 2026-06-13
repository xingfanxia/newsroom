type QueryParseSuccess<T> = {
  ok: true;
  data: T;
};

type QueryParseFailure = {
  ok: false;
  issues: unknown[];
};

type QueryParamSchema<T> = {
  safeParse(
    input: Record<string, string>,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: unknown[] } };
};

type QueryParamSource = Request | URL | URLSearchParams | Record<string, string>;

export type QueryParseResult<T> = QueryParseSuccess<T> | QueryParseFailure;

export function queryParamsRecord(source: QueryParamSource): Record<string, string> {
  if (source instanceof Request) {
    return queryParamsRecord(new URL(source.url).searchParams);
  }
  if (source instanceof URL) {
    return queryParamsRecord(source.searchParams);
  }
  if (source instanceof URLSearchParams) {
    return Object.fromEntries(source.entries());
  }
  return source;
}

export function parseQueryParams<T>(
  source: QueryParamSource,
  schema: QueryParamSchema<T>,
): QueryParseResult<T> {
  const parsed = schema.safeParse(queryParamsRecord(source));
  if (!parsed.success) return { ok: false, issues: parsed.error.issues };
  return { ok: true, data: parsed.data };
}

export function invalidQueryError(issues: readonly unknown[]): string {
  return `invalid_query: ${formatQueryIssues(issues)}`;
}

export function formatQueryIssues(issues: readonly unknown[]): string {
  return issues.map(queryIssueMessage).join("; ");
}

function queryIssueMessage(issue: unknown): string {
  if (
    typeof issue === "object" &&
    issue !== null &&
    "message" in issue
  ) {
    return String((issue as { message: unknown }).message);
  }
  return String(issue);
}
