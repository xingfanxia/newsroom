import { runScoreBackfill } from "@/workers/enrich/score-backfill";
import { runCommentaryBackfill } from "@/workers/enrich/commentary";
console.log("Score backfill (adding HKR to existing items)...");
const score = await runScoreBackfill();
console.log(JSON.stringify(score, null, 2));
console.log("\nCommentary backfill (filling missing editor notes)...");
const commentary = await runCommentaryBackfill();
console.log(JSON.stringify(commentary, null, 2));
process.exit(0);
