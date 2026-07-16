import { describe, expect, test } from "bun:test";
import {
  createResendClient,
  ResendApiError,
  RESEND_BATCH_LIMIT,
  type OutgoingEmail,
} from "@/lib/email/resend";

function email(overrides: Partial<OutgoingEmail> = {}): OutgoingEmail {
  return {
    from: "AX 的 AI 雷达 <daily@news.ax0x.ai>",
    to: "reader@example.com",
    subject: "【AX 日报】测试",
    html: "<p>hi</p>",
    text: "hi",
    ...overrides,
  };
}

type CapturedRequest = { url: string; init: RequestInit };

function fakeFetch(
  status: number,
  body: unknown,
): { fetchImpl: typeof fetch; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

describe("createResendClient", () => {
  test("throws loudly without an API key", () => {
    expect(() =>
      createResendClient({ apiKey: "", fetchImpl: fakeFetch(200, {}).fetchImpl }),
    ).toThrow(/RESEND_API_KEY/);
  });

  test("sendEmail posts to /emails with bearer auth and returns id", async () => {
    const { fetchImpl, requests } = fakeFetch(200, { id: "re_123" });
    const client = createResendClient({ apiKey: "re_test", fetchImpl });
    const result = await client.sendEmail(email({ replyTo: "me@example.com" }));
    expect(result).toEqual({ id: "re_123" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.resend.com/emails");
    const headers = requests[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test");
    const payload = JSON.parse(String(requests[0]?.init.body));
    expect(payload.reply_to).toBe("me@example.com");
    expect(payload.to).toEqual(["reader@example.com"]);
  });

  test("sendBatch posts array to /emails/batch with idempotency key", async () => {
    const { fetchImpl, requests } = fakeFetch(200, {
      data: [{ id: "re_1" }, { id: "re_2" }],
    });
    const client = createResendClient({ apiKey: "re_test", fetchImpl });
    const result = await client.sendBatch(
      [email(), email({ to: "two@example.com" })],
      { idempotencyKey: "newsroom/daily_digest/2026-07-16/abc" },
    );
    expect(result).toEqual({ ids: ["re_1", "re_2"] });
    expect(requests[0]?.url).toBe("https://api.resend.com/emails/batch");
    const headers = requests[0]?.init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe(
      "newsroom/daily_digest/2026-07-16/abc",
    );
    const payload = JSON.parse(String(requests[0]?.init.body));
    expect(payload).toHaveLength(2);
    expect(payload[1].to).toEqual(["two@example.com"]);
  });

  test("sendBatch refuses more than the batch limit before any network", async () => {
    const { fetchImpl, requests } = fakeFetch(200, { data: [] });
    const client = createResendClient({ apiKey: "re_test", fetchImpl });
    const emails = Array.from({ length: RESEND_BATCH_LIMIT + 1 }, () => email());
    await expect(client.sendBatch(emails)).rejects.toThrow(/batch/i);
    expect(requests).toHaveLength(0);
  });

  test("non-2xx responses throw a typed error carrying status and body", async () => {
    const { fetchImpl } = fakeFetch(422, {
      message: "Invalid `to` field",
    });
    const client = createResendClient({ apiKey: "re_test", fetchImpl });
    const error = await client.sendEmail(email()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResendApiError);
    expect((error as ResendApiError).status).toBe(422);
    expect((error as ResendApiError).message).toContain("Invalid `to` field");
  });

  test("per-email headers pass through (List-Unsubscribe)", async () => {
    const { fetchImpl, requests } = fakeFetch(200, { id: "re_1" });
    const client = createResendClient({ apiKey: "re_test", fetchImpl });
    await client.sendEmail(
      email({
        headers: {
          "List-Unsubscribe": "<https://news.ax0x.ai/api/newsletter/unsubscribe?token=t>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    );
    const payload = JSON.parse(String(requests[0]?.init.body));
    expect(payload.headers["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click",
    );
  });
});
