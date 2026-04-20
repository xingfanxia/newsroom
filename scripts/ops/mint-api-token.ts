/**
 * mint-api-token — CLI for managing Bearer tokens that unlock /api/v1/*.
 *
 * Usage:
 *   bun scripts/ops/mint-api-token.ts mint [label]
 *   bun scripts/ops/mint-api-token.ts list
 *   bun scripts/ops/mint-api-token.ts revoke <id>
 *
 * The plaintext token is printed exactly once at mint time. If you lose it,
 * revoke the row and mint a new one — there is no recovery path because we
 * only store sha256(token) in the DB.
 */
import { randomBytes } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { apiTokens } from "@/db/schema";
import { ADMIN_USER_ID, upsertAppUser } from "@/lib/auth/session";
import { hashToken } from "@/lib/auth/api-token";

const [cmd = "mint", ...args] = process.argv.slice(2);

async function mint(label: string) {
  await upsertAppUser({
    id: ADMIN_USER_ID,
    email: "admin@local",
    isAdmin: true,
  });
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const client = db();
  const [row] = await client
    .insert(apiTokens)
    .values({ userId: ADMIN_USER_ID, tokenHash, label })
    .returning({
      id: apiTokens.id,
      label: apiTokens.label,
      createdAt: apiTokens.createdAt,
    });

  console.log(`\n✓ Minted token #${row.id} (label="${row.label}")\n`);
  console.log("  Copy this now — it will NOT be shown again:\n");
  console.log(`    ${token}\n`);
  console.log("  Sanity check:");
  console.log(
    `    curl -H 'Authorization: Bearer ${token}' http://localhost:3000/api/v1/feed\n`,
  );
}

async function list() {
  const client = db();
  const rows = await client
    .select()
    .from(apiTokens)
    .orderBy(desc(apiTokens.createdAt));
  if (rows.length === 0) {
    console.log("(no tokens minted yet)");
    return;
  }
  console.log(`\n${rows.length} token(s):\n`);
  for (const r of rows) {
    const revoked = r.revokedAt
      ? ` [REVOKED ${r.revokedAt.toISOString()}]`
      : "";
    const lastUsed = r.lastUsedAt ? r.lastUsedAt.toISOString() : "never";
    console.log(
      `  #${String(r.id).padEnd(4)} ${r.label.padEnd(28)} last-used=${lastUsed}${revoked}`,
    );
  }
  console.log("");
}

async function revoke(idRaw: string | undefined) {
  const id = Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) {
    console.error("usage: bun scripts/ops/mint-api-token.ts revoke <id>");
    process.exit(1);
  }
  const client = db();
  const result = await client
    .update(apiTokens)
    .set({ revokedAt: sql`now()` })
    .where(eq(apiTokens.id, id))
    .returning({ id: apiTokens.id, label: apiTokens.label });
  if (result.length === 0) {
    console.error(`no token with id=${id}`);
    process.exit(1);
  }
  console.log(`✓ revoked #${result[0].id} (label="${result[0].label}")`);
}

switch (cmd) {
  case "mint":
    await mint(args[0] ?? "cli-minted");
    break;
  case "list":
    await list();
    break;
  case "revoke":
    await revoke(args[0]);
    break;
  default:
    console.error(
      `unknown command: ${cmd}\n\n` +
        `usage:\n` +
        `  bun scripts/ops/mint-api-token.ts mint [label]\n` +
        `  bun scripts/ops/mint-api-token.ts list\n` +
        `  bun scripts/ops/mint-api-token.ts revoke <id>\n`,
    );
    process.exit(1);
}

process.exit(0);
