import { describe, expect, test } from "bun:test";
import {
  readRequestBytes,
  readResponseBytes,
  readResponseJson,
  readResponseText,
  ResponseBodyTooLargeError,
} from "@/lib/http/response-body";
import { CURRENT_POINTER_KEY } from "@/lib/public-content/paths";
import { PublicSnapshotHttpFetcher } from "@/lib/public-content/reader/fetch-object";

describe("bounded HTTP body reads", () => {
  test("reads text and JSON within the byte budget", async () => {
    expect(await readResponseText(new Response("hello"), 5)).toBe("hello");
    expect(
      await readResponseJson<{ ok: boolean }>(
        new Response(JSON.stringify({ ok: true })),
        32,
      ),
    ).toEqual({ ok: true });
  });

  test("rejects a declared oversized response before buffering it", async () => {
    const response = new Response("small", {
      headers: { "content-length": "1024" },
    });

    await expect(readResponseBytes(response, 32)).rejects.toBeInstanceOf(
      ResponseBodyTooLargeError,
    );
  });

  test("rejects a streamed oversized response without Content-Length", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(20));
          controller.enqueue(new Uint8Array(20));
          controller.close();
        },
      }),
    );

    await expect(readResponseBytes(response, 32)).rejects.toBeInstanceOf(
      ResponseBodyTooLargeError,
    );
  });

  test("applies the same stream cap to incoming requests", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      body: "123456789",
    });

    await expect(readRequestBytes(request, 8)).rejects.toBeInstanceOf(
      ResponseBodyTooLargeError,
    );
  });
});

describe("bounded public snapshot transport", () => {
  test("retries a stream failure instead of misclassifying it as oversize", async () => {
    let calls = 0;
    const fetcher = new PublicSnapshotHttpFetcher({
      baseUrl: "https://public-content.test",
      fetch: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.error(new Error("stream reset"));
              },
            }),
          );
        }
        return new Response("{}", { status: 200 });
      },
    });

    const result = await fetcher.read(CURRENT_POINTER_KEY, {
      immutable: false,
      maxBytes: 32,
    });
    expect(calls).toBe(2);
    expect(new TextDecoder().decode(result.bytes)).toBe("{}");
  });
});
