/**
 * Read a Fetch response without trusting Content-Length. Serverless routes and
 * cron workers must bound the bytes they accept from remote services: a
 * missing/incorrect header must not turn `response.text()` / `.json()` into an
 * unbounded allocation.
 */
export class ResponseBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`response body exceeds ${maxBytes} bytes`);
    this.name = "ResponseBodyTooLargeError";
  }
}

export async function readResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("response maxBytes must be a positive safe integer");
  }

  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const declaredBytes = Number(declared);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      await response.body?.cancel();
      throw new ResponseBodyTooLargeError(maxBytes);
    }
  }

  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ResponseBodyTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (!(error instanceof ResponseBodyTooLargeError)) {
      await reader.cancel().catch(() => undefined);
    }
    throw error;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  return new TextDecoder("utf-8", { fatal: false }).decode(
    await readResponseBytes(response, maxBytes),
  );
}

export async function readResponseJson<T>(
  response: Response,
  maxBytes: number,
): Promise<T> {
  return JSON.parse(await readResponseText(response, maxBytes)) as T;
}

export async function readRequestBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const headers = new Headers();
  const declared = request.headers.get("content-length");
  if (declared !== null) headers.set("content-length", declared);
  return readResponseBytes(new Response(request.body, { headers }), maxBytes);
}
