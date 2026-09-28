import { Annotation } from "@langchain/langgraph";

// Deliberately flat and small — this repo exists to prove the checkpointing
// + interrupt() pattern in LangGraph.js, not to re-implement the Python
// sibling's full corrective-RAG state machine.
export const RfpAgentState = Annotation.Root({
  question: Annotation<string>,
  answer: Annotation<string | null>({ reducer: (_prev, next) => next, default: () => null }),
  citedChunkId: Annotation<string | null>({ reducer: (_prev, next) => next, default: () => null }),
  hasCitation: Annotation<boolean>({ reducer: (_prev, next) => next, default: () => false }),
  retryCount: Annotation<number>({ reducer: (_prev, next) => next, default: () => 0 }),
  maxRetries: Annotation<number>({ reducer: (_prev, next) => next, default: () => 2 }),
  requireApproval: Annotation<boolean>({ reducer: (_prev, next) => next, default: () => false }),
  approvalStatus: Annotation<"not_required" | "pending" | "approved" | "rejected">({
    reducer: (_prev, next) => next,
    default: () => "not_required",
  }),
  // Transient routing decision written by critiqueNode and read by the
  // conditional edge straight after it — not meaningful outside that one hop.
  needsRetry: Annotation<boolean>({ reducer: (_prev, next) => next, default: () => false }),
});

export type RfpState = typeof RfpAgentState.State;
