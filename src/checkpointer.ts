import { MemorySaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

// Mirrors app/services/checkpointer.py in the Python sibling repo exactly:
// Postgres when a real DATABASE_URL is configured, in-memory otherwise.
// Same local Postgres instance used to verify that project's checkpointing —
// this repo's demo script points at a separate database on it.
let cached: BaseCheckpointSaver | null = null;

export async function getCheckpointer(): Promise<BaseCheckpointSaver> {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (url && url.startsWith("postgresql")) {
    const saver = PostgresSaver.fromConnString(url);
    await saver.setup(); // idempotent; must be called before first use
    cached = saver;
    return saver;
  }

  cached = new MemorySaver();
  return cached;
}
