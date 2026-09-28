import { randomUUID } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { StateGraph, START, END, Command, interrupt } from "@langchain/langgraph";
import { RfpAgentState, type RfpState } from "./state.js";
import { getCheckpointer } from "./checkpointer.js";
import { retrieve } from "./knowledgeBase.js";
import { draftAnswer } from "./llm.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Same £/$ commercial-figure trigger as the Python sibling's approval_gate_node —
// a real irreversible action (releasing a number a client could hold you to),
// not a manufactured one.
const COMMERCIAL_FIGURE = /[£$]\s?[\d,]+(?:\.\d+)?/;

async function draftNode(state: RfpState): Promise<Partial<RfpState>> {
  // Demo-only hook for scripts/demo-kill-and-resume.ts, unset in normal
  // operation (tests, the exported API): records that draft genuinely ran,
  // so a resumed-after-crash run can prove it did NOT re-run this node.
  if (process.env.DEMO_DRAFT_COUNTER_FILE) {
    appendFileSync(process.env.DEMO_DRAFT_COUNTER_FILE, "1\n");
  }
  const context = retrieve(state.question);
  const result = await draftAnswer(state.question, context);
  return {
    answer: result.text,
    citedChunkId: result.citedChunkId,
    hasCitation: result.citedChunkId !== null,
  };
}

// Bounded draft -> critique -> retry cycle: the one required "cycle" in the
// graph, same shape as the Python repo's critique_node, just without a
// separate faithfulness-score LLM call — citation presence is the gate here.
async function critiqueNode(state: RfpState): Promise<Partial<RfpState>> {
  // Demo-only hooks, same rationale as draftNode above — give the kill-and-
  // resume orchestrator a window to SIGKILL the process mid-critique, after
  // draft's checkpoint has already been committed.
  if (process.env.DEMO_CRITIQUE_MARKER_FILE) {
    writeFileSync(process.env.DEMO_CRITIQUE_MARKER_FILE, String(Date.now()));
  }
  if (process.env.DEMO_CRITIQUE_DELAY_MS) {
    await sleep(Number(process.env.DEMO_CRITIQUE_DELAY_MS));
  }
  if (!state.hasCitation && state.retryCount < state.maxRetries) {
    return { needsRetry: true, retryCount: state.retryCount + 1 };
  }
  return { needsRetry: false };
}

// Genuine interrupt() pause, not a UI banner — mirrors approval_gate_node in
// app/services/rag_graph.py exactly: opt-in via requireApproval, only fires
// when the drafted answer actually quotes a commercial figure.
function approvalGateNode(state: RfpState): Partial<RfpState> {
  if (!state.requireApproval || !state.answer || !COMMERCIAL_FIGURE.test(state.answer)) {
    return { approvalStatus: "not_required" };
  }
  const decision = interrupt({
    reason: "Answer quotes a commercial figure and needs bid-director sign-off.",
    question: state.question,
    draftAnswer: state.answer,
  }) as { approved: boolean };
  // A rejection means the figure genuinely doesn't get released — clearing
  // `answer` here, not just flagging it, is the difference this gate exists for.
  if (!decision.approved) {
    return { approvalStatus: "rejected", answer: null };
  }
  return { approvalStatus: "approved" };
}

let compiledGraph: Awaited<ReturnType<typeof compileGraph>> | null = null;

async function compileGraph() {
  const checkpointer = await getCheckpointer();
  return new StateGraph(RfpAgentState)
    .addNode("draft", draftNode)
    .addNode("critique", critiqueNode)
    .addNode("approvalGate", approvalGateNode)
    .addEdge(START, "draft")
    .addEdge("draft", "critique")
    .addConditionalEdges("critique", (state) => (state.needsRetry ? "retry" : "proceed"), {
      retry: "draft",
      proceed: "approvalGate",
    })
    .addEdge("approvalGate", END)
    .compile({ checkpointer });
}

async function getGraph() {
  compiledGraph ??= await compileGraph();
  return compiledGraph;
}

// Exposed for scripts/demo-kill-and-resume.ts only: recovering from a genuine
// process crash means invoking with `null` input on the same thread_id, so
// LangGraph continues from the last committed checkpoint instead of
// restarting at START — answerQuestion() always starts at START on purpose,
// so it can't be reused for this case.
export async function getGraphForCrashRecovery() {
  return getGraph();
}

export interface AnswerResult {
  threadId: string;
  answer: string | null;
  citedChunkId: string | null;
  retries: number;
  pendingApproval: boolean;
  approvalStatus: RfpState["approvalStatus"];
}

async function buildResult(threadId: string, config: { configurable: { thread_id: string } }): Promise<AnswerResult> {
  const graph = await getGraph();
  const snapshot = await graph.getState(config);
  const pendingApproval = snapshot.tasks.some((t) => t.interrupts.length > 0);
  const values = snapshot.values as RfpState;
  return {
    threadId,
    answer: pendingApproval ? null : values.answer,
    citedChunkId: values.citedChunkId,
    retries: values.retryCount,
    pendingApproval,
    approvalStatus: pendingApproval ? "pending" : values.approvalStatus,
  };
}

export interface AnswerOptions {
  threadId?: string;
  requireApproval?: boolean;
  maxRetries?: number;
}

export async function answerQuestion(question: string, opts: AnswerOptions = {}): Promise<AnswerResult> {
  const graph = await getGraph();
  const threadId = opts.threadId ?? randomUUID();
  const config = { configurable: { thread_id: threadId } };
  await graph.invoke(
    { question, requireApproval: opts.requireApproval ?? false, maxRetries: opts.maxRetries ?? 2 },
    config,
  );
  return buildResult(threadId, config);
}

// Mirrors resume_approval() in the Python sibling, including the same fix:
// check for a genuinely paused run first rather than letting LangGraph's own
// resume call fail ambiguously for "never existed" vs "already resolved".
export async function resumeApproval(threadId: string, approved: boolean): Promise<AnswerResult> {
  const graph = await getGraph();
  const config = { configurable: { thread_id: threadId } };
  const snapshot = await graph.getState(config);
  const isPaused = snapshot.tasks.some((t) => t.interrupts.length > 0);
  if (!isPaused) {
    throw new Error(`No pending approval for thread ${threadId}`);
  }
  await graph.invoke(new Command({ resume: { approved } }), config);
  return buildResult(threadId, config);
}
