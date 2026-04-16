/**
 * Smoke test for the LLM provider layer.
 * Calls each configured provider with a 1-shot minimal prompt.
 *
 * Usage: bun run scripts/ops/ping-llm.ts
 */
import { generateText, availableProviders } from "@/lib/llm";

async function main() {
  const providers = availableProviders();
  console.log(`configured providers: ${providers.join(", ")}`);

  for (const provider of providers) {
    process.stdout.write(`  ${provider}… `);
    try {
      const result = await generateText({
        provider,
        messages: [
          {
            role: "user",
            content: "Reply with exactly three words: 'hello from <your-name>'.",
          },
        ],
        maxTokens: 512,
      });
      console.log(
        `✓ model=${result.model} text=${JSON.stringify(result.text.slice(0, 80))} tokens=${result.inputTokens}/${result.outputTokens}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗ ${msg}`);
    }
  }
}

main();
