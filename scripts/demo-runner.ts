// Child process entrypoint for demo-kill-and-resume.ts. Not part of the
// public API, invoked directly by the orchestrator via `tsx`.
import { answerQuestion, getGraphForCrashRecovery } from "../src/agent.js";

const [, , threadId, mode] = process.argv;

async function main() {
  if (mode === "run") {
    console.log(`[runner:${process.pid}] starting fresh run on thread ${threadId}`);
    await answerQuestion("What is Aldermere's data retention policy?", { threadId });
    console.log(`[runner:${process.pid}] completed without being killed (unexpected for this demo)`);
    return;
  }

  if (mode === "resume") {
    console.log(`[runner:${process.pid}] resuming thread ${threadId} from the last Postgres checkpoint`);
    const graph = await getGraphForCrashRecovery();
    const result = await graph.invoke(null, { configurable: { thread_id: threadId } });
    console.log(`[runner:${process.pid}] resumed run completed:`, JSON.stringify(result.answer));
    return;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
