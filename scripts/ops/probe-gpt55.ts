import { generateText, generateStructured, embed } from "@/lib/llm";
import { z } from "zod";

console.log("─── chat (gpt-5.5-standard) ───");
const text = await generateText({
  task: "smoke",
  provider: "azure-openai",
  messages: [{ role: "user", content: "Reply with the JSON {\"ok\":true} only." }],
  maxTokens: 200,
});
console.log("model:", text.model, "| text:", text.text.slice(0, 100));

console.log("─── structured (gpt-5.5-standard) ───");
const struct = await generateStructured({
  task: "smoke",
  provider: "azure-openai",
  schema: z.object({ ok: z.boolean(), greeting: z.string() }),
  schemaName: "smoke",
  messages: [{ role: "user", content: "Return ok=true and greeting='hi'." }],
  maxTokens: 200,
});
console.log("model:", struct.model, "| data:", struct.data);

console.log("─── embed (text-embedding-3-large on legacy endpoint) ───");
const emb = await embed({ task: "smoke", value: "hello world" });
console.log("model:", emb.model, "| dims:", emb.embedding.length);
