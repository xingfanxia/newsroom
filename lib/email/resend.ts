/**
 * Resend delivery adapter — raw fetch, no npm dep (PLAN.md §1.5).
 * Our Turso tables are the source of truth; Resend is dumb delivery.
 * Batch calls count as ONE rate-limit request and accept an
 * Idempotency-Key header (24h window).
 */
export type OutgoingEmail = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  replyTo?: string;
};

export type ResendClient = {
  sendEmail(email: OutgoingEmail): Promise<{ id: string }>;
  sendBatch(
    emails: OutgoingEmail[],
    opts?: { idempotencyKey?: string },
  ): Promise<{ ids: string[] }>;
};

export const RESEND_BATCH_LIMIT = 100;

const RESEND_API_ORIGIN = "https://api.resend.com";

export class ResendApiError extends Error {
  readonly status: number;

  constructor(status: number, body: string) {
    super(`Resend API ${status}: ${body}`);
    this.name = "ResendApiError";
    this.status = status;
  }
}

type ResendDeps = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** Per-request ceiling — a hung connection must not stall the send worker. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;

function toApiPayload(email: OutgoingEmail): Record<string, unknown> {
  return {
    from: email.from,
    to: [email.to],
    subject: email.subject,
    html: email.html,
    text: email.text,
    ...(email.headers ? { headers: email.headers } : {}),
    ...(email.replyTo ? { reply_to: email.replyTo } : {}),
  };
}

export function createResendClient(deps: ResendDeps = {}): ResendClient {
  const apiKey = deps.apiKey ?? process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not set — required for newsletter email delivery",
    );
  }
  const fetchImpl = deps.fetchImpl ?? fetch;

  async function post(
    path: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<unknown> {
    const response = await fetchImpl(`${RESEND_API_ORIGIN}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const raw = await response.text();
    if (!response.ok) {
      let message = raw;
      try {
        const parsed = JSON.parse(raw) as { message?: string };
        if (parsed.message) message = parsed.message;
      } catch {
        // keep raw body
      }
      const error = new ResendApiError(response.status, message);
      console.error(`[email/resend] POST ${path} failed:`, error.message);
      throw error;
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      const error = new ResendApiError(
        response.status,
        `non-JSON success body: ${raw.slice(0, 200)}`,
      );
      console.error(`[email/resend] POST ${path} failed:`, error.message);
      throw error;
    }
  }

  return {
    async sendEmail(email) {
      const result = (await post("/emails", toApiPayload(email))) as {
        id?: string;
      };
      return { id: String(result.id ?? "") };
    },
    async sendBatch(emails, opts = {}) {
      if (emails.length > RESEND_BATCH_LIMIT) {
        throw new Error(
          `Resend batch limit is ${RESEND_BATCH_LIMIT} emails; got ${emails.length} — chunk before calling sendBatch`,
        );
      }
      const result = (await post(
        "/emails/batch",
        emails.map(toApiPayload),
        opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {},
      )) as { data?: Array<{ id?: string }> };
      return { ids: (result.data ?? []).map((row) => String(row.id ?? "")) };
    },
  };
}
