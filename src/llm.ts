import { ChatAnthropic } from "@langchain/anthropic";
import type { KnowledgeChunk } from "./knowledgeBase.js";

export interface DraftResult {
  text: string;
  citedChunkId: string | null;
}

const NO_CONTEXT_ANSWER =
  "I don't have that in the corpus I was given, so I can't answer this without guessing at a commercial term. This needs a human to check the rate card or engagement terms directly.";

// Real Anthropic call when a key is present (same honesty pattern as the
// Python sibling: don't fabricate a "live" number when the key is
// quota-limited or absent — say so and fall back to a deterministic,
// still-correctly-cited draft instead of a canned string pretending to be one).
export async function draftAnswer(question: string, context: KnowledgeChunk[]): Promise<DraftResult> {
  if (context.length === 0) {
    return { text: NO_CONTEXT_ANSWER, citedChunkId: null };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const model = new ChatAnthropic({ model: "claude-3-5-haiku-latest", maxTokens: 300 });
    const system =
      "Answer the question using ONLY the numbered context below. Cite the chunk you used " +
      'as "[Source <id>]" at the end of your answer. If the context does not answer the ' +
      "question, say so plainly instead of guessing.";
    const contextBlock = context.map((c) => `[${c.id}] ${c.text}`).join("\n");
    const result = await model.invoke([
      { role: "system", content: system },
      { role: "user", content: `Context:\n${contextBlock}\n\nQuestion: ${question}` },
    ]);
    const text = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
    const cited = context.find((c) => text.includes(c.id));
    return { text, citedChunkId: cited?.id ?? null };
  }

  // No key configured — deterministic draft so the graph, retries and tests
  // are fully exercisable offline, same reasoning as the Python repo's
  // quota-limited note in docs/EVALUATION.md.
  const top = context[0];
  return { text: `${top.text} [Source ${top.id}]`, citedChunkId: top.id };
}
