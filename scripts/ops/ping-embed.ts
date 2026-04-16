/**
 * Smoke test for the embedding layer.
 * Usage: bun run scripts/ops/ping-embed.ts
 */
import { embed, embedMany } from "@/lib/llm";

async function main() {
  const single = await embed({ value: "hello from AX's AI RADAR" });
  console.log(
    `embed: model=${single.model} dims=${single.embedding.length} tokens=${single.tokens} first5=[${single.embedding.slice(0, 5).map((n) => n.toFixed(4)).join(", ")}]`,
  );

  const multi = await embedMany({
    values: [
      "claude releases new computer-use feature",
      "anthropic launches computer-use for Pro and Max",
      "cat jumps on keyboard",
    ],
  });
  console.log(
    `embedMany: model=${multi.model} batch=${multi.embeddings.length} dims=${multi.embeddings[0]?.length ?? 0} tokens=${multi.tokens}`,
  );

  // Quick similarity sanity: first two should be very similar, third divergent
  const dot = (a: number[], b: number[]) =>
    a.reduce((s, x, i) => s + x * b[i], 0) /
    Math.sqrt(a.reduce((s, x) => s + x * x, 0)) /
    Math.sqrt(b.reduce((s, x) => s + x * x, 0));
  console.log(
    `  sim(claude, anthropic) = ${dot(multi.embeddings[0], multi.embeddings[1]).toFixed(3)}`,
  );
  console.log(
    `  sim(claude, cat)       = ${dot(multi.embeddings[0], multi.embeddings[2]).toFixed(3)}`,
  );
}

main();
