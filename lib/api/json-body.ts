import type { ZodIssue, ZodType } from "zod";
import { okError } from "@/lib/api/ok-response";
import { plainError } from "@/lib/api/plain-response";

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
  return envelope === "ok"
    ? okError(error, 400, issuePayload)
    : plainError(error, 400, issuePayload);
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
