import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  jsonBodyErrorResponse,
  parseJsonRequestBody,
} from "@/lib/api/json-body";

const bodySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
});

function jsonRequest(body: string): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    body,
  });
}

describe("jsonBodyErrorResponse", () => {
  test("renders cookie/admin route envelopes with ok=false", async () => {
    const res = jsonBodyErrorResponse("ok", "invalid_json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: "invalid_json",
    });
  });

  test("renders v1/plain route envelopes without ok", async () => {
    const res = jsonBodyErrorResponse("plain", "invalid_json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid_json",
    });
  });
});

describe("parseJsonRequestBody", () => {
  test("returns parsed data for valid JSON bodies", async () => {
    const parsed = await parseJsonRequestBody(
      jsonRequest(JSON.stringify({ id: 1, name: "Saved" })),
      bodySchema,
      { envelope: "plain" },
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data).toEqual({ id: 1, name: "Saved" });
    }
  });

  test("maps malformed JSON to invalid_json", async () => {
    const parsed = await parseJsonRequestBody(jsonRequest("{"), bodySchema, {
      envelope: "ok",
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.response.status).toBe(400);
      expect(await parsed.response.json()).toEqual({
        ok: false,
        error: "invalid_json",
      });
    }
  });

  test("includes Zod issues by default for invalid bodies", async () => {
    const parsed = await parseJsonRequestBody(
      jsonRequest(JSON.stringify({ id: 0, name: "" })),
      bodySchema,
      { envelope: "plain" },
    );

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      const body = (await parsed.response.json()) as { issues?: unknown[] };
      expect(body.issues?.length).toBeGreaterThan(0);
    }
  });

  test("can suppress issues for endpoints with compact error contracts", async () => {
    const parsed = await parseJsonRequestBody(
      jsonRequest(JSON.stringify({ id: 0, name: "" })),
      bodySchema,
      { envelope: "ok", includeIssues: false },
    );

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(await parsed.response.json()).toEqual({
        ok: false,
        error: "invalid_body",
      });
    }
  });
});
