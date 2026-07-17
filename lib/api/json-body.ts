import type { ZodIssue, ZodType } from "zod";
import { okError } from "@/lib/api/ok-response";
import { plainError } from "@/lib/api/plain-response";
import {
  readRequestBytes,
  ResponseBodyTooLargeError,
} from "@/lib/http/response-body";

export type JsonBodyEnvelope = "ok" | "plain";
export type JsonBodyError =
  | "invalid_json"
  | "invalid_body"
  | "payload_too_large";

export type ParsedJsonRequestBody<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

export type ParseJsonRequestBodyOptions = {
  envelope: JsonBodyEnvelope;
  includeIssues?: boolean;
  maxBytes?: number;
};

const DEFAULT_JSON_BODY_MAX_BYTES = 64 * 1024;

export function jsonBodyErrorResponse(
  envelope: JsonBodyEnvelope,
  error: JsonBodyError,
  issues?: ZodIssue[],
): Response {
  const issuePayload = issues ? { issues } : {};
  const status = error === "payload_too_large" ? 413 : 400;
  return envelope === "ok"
    ? okError(error, status, issuePayload)
    : plainError(error, status, issuePayload);
}

export async function parseJsonRequestBody<T>(
  req: Request,
  schema: ZodType<T>,
  options: ParseJsonRequestBodyOptions,
): Promise<ParsedJsonRequestBody<T>> {
  let raw: unknown;
  try {
    const bytes = await readRequestBytes(
      req,
      options.maxBytes ?? DEFAULT_JSON_BODY_MAX_BYTES,
    );
    raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    return {
      ok: false,
      response: jsonBodyErrorResponse(
        options.envelope,
        error instanceof ResponseBodyTooLargeError
          ? "payload_too_large"
          : "invalid_json",
      ),
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
