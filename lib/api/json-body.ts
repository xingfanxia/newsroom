import type { ZodIssue, ZodType } from "zod";

export type JsonBodyEnvelope = "ok" | "plain";
export type JsonBodyError = "invalid_json" | "invalid_body";

export type ParsedJsonRequestBody<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

export type ParseJsonRequestBodyOptions = {
  envelope: JsonBodyEnvelope;
  includeIssues?: boolean;
};

export function jsonBodyErrorResponse(
  envelope: JsonBodyEnvelope,
  error: JsonBodyError,
  issues?: ZodIssue[],
): Response {
  const issuePayload = issues ? { issues } : {};
  const body =
    envelope === "ok"
      ? { ok: false, error, ...issuePayload }
      : { error, ...issuePayload };
  return Response.json(body, { status: 400 });
}

export async function parseJsonRequestBody<T>(
  req: Request,
  schema: ZodType<T>,
  options: ParseJsonRequestBodyOptions,
): Promise<ParsedJsonRequestBody<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: jsonBodyErrorResponse(options.envelope, "invalid_json"),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: jsonBodyErrorResponse(
        options.envelope,
        "invalid_body",
        options.includeIssues === false ? undefined : parsed.error.issues,
      ),
    };
  }

  return { ok: true, data: parsed.data };
}
