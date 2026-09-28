// Real, not simulated: spawns a real OS process, sends it a real SIGKILL
// mid-graph, then spawns a second fresh process that resumes the same
// thread_id from real Postgres. Mirrors scripts/demo_kill_and_resume.py in
// the Python sibling repo exactly, one language over.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://localhost/rfp_agent_ts";
const threadId = randomUUID();
const counterFile = new URL("./.demo-draft-calls.tmp", import.meta.url);
const markerFile = new URL("./.demo-critique-started.tmp", import.meta.url);

for (const f of [counterFile, markerFile]) {
  if (existsSync(f)) rmSync(f);
}

function countLines(url: URL): number {
  if (!existsSync(url)) return 0;
  return readFileSync(url, "utf8").split("\n").filter(Boolean).length;
}

console.log(`[orchestrator] thread_id = ${threadId}`);
console.log("[orchestrator] starting run 1 — will SIGKILL it once critique has started\n");

const run1 = spawn("npx", ["tsx", "scripts/demo-runner.ts", threadId, "run"], {
  env: {
    ...process.env,
    DATABASE_URL,
    DEMO_DRAFT_COUNTER_FILE: counterFile.pathname,
    DEMO_CRITIQUE_MARKER_FILE: markerFile.pathname,
    DEMO_CRITIQUE_DELAY_MS: "4000",
  },
  stdio: "inherit",
});

let killed = false;
const poll = setInterval(() => {
  if (killed || !existsSync(markerFile)) return;
  killed = true;
  clearInterval(poll);
  console.log("\n[orchestrator] critique node has started — draft's checkpoint is already committed.");
  console.log("[orchestrator] sending SIGKILL now.\n");
  run1.kill("SIGKILL");
}, 100);

run1.on("exit", (code, signal) => {
  clearInterval(poll);
  console.log(`\n[orchestrator] run 1 exited — code=${code} signal=${signal}`);
  if (signal !== "SIGKILL") {
    console.error("[orchestrator] run 1 did not die by SIGKILL — demo is invalid, aborting.");
    process.exit(1);
  }

  const draftCallsBeforeResume = countLines(counterFile);
  console.log(`[orchestrator] draftNode ran ${draftCallsBeforeResume} time(s) before the kill`);
  console.log("\n[orchestrator] starting run 2 (fresh process) — resuming from the Postgres checkpoint\n");

  const run2 = spawn("npx", ["tsx", "scripts/demo-runner.ts", threadId, "resume"], {
    env: { ...process.env, DATABASE_URL, DEMO_DRAFT_COUNTER_FILE: counterFile.pathname },
    stdio: "inherit",
  });

  run2.on("exit", (resumeCode) => {
    const draftCallsAfterResume = countLines(counterFile);
    console.log(`\n[orchestrator] draftNode has run ${draftCallsAfterResume} time(s) total (was ${draftCallsBeforeResume} before resume)`);

    const draftWasNotRerun = draftCallsAfterResume === draftCallsBeforeResume;
    console.log(
      draftWasNotRerun
        ? "[orchestrator] draft was NOT re-run — the resumed process continued from the committed checkpoint."
        : "[orchestrator] draft WAS re-run — checkpointing did not hold as expected.",
    );
    process.exit(resumeCode === 0 && draftWasNotRerun ? 0 : 1);
  });
});
