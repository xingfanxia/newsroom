import { closeDb, libsqlClient } from "@/db/client";
import { migrateNewsletterEmail } from "@/lib/email/migration";

if (!Bun.argv.includes("--apply")) {
  throw new Error(
    "Refusing to mutate the database without --apply. Run this operator migration explicitly.",
  );
}

try {
  const result = await migrateNewsletterEmail(libsqlClient());
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await closeDb();
}
