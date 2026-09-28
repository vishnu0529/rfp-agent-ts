# rfp-agent-ts

A small LangGraph.js agent proving the two things that actually separate a
production agent from a demo — **durable checkpointing** and a genuine
**human-in-the-loop `interrupt()`** — in TypeScript, on Node.

This is the TS/Node counterpart to
[enterprise-rag-assistant](https://github.com/vishnu0529/enterprise-rag-assistant),
not a second demo. Same fictional client (Aldermere Consulting), same two
hardening patterns, same honesty rules: nothing here is claimed that isn't
either a passing test or a command you can rerun yourself.

## Why this exists

A recruiter conversation surfaced that a meaningful share of agentic roles in
this market run on TypeScript/Node rather than Python. The Python repo already
proves the pattern works; this repo proves it isn't a Python-specific trick —
the same checkpointing and interrupt semantics hold in LangGraph.js too.

## What's here

| | |
|---|---|
| Graph | `draft → critique → (retry loop, bounded) → approvalGate` — a real `StateGraph`, not a chain, with one cycle |
| Checkpointing | `PostgresSaver` when `DATABASE_URL` is a real Postgres URL, `MemorySaver` otherwise — same fallback rule as the Python repo's `checkpointer.py` |
| Human-in-the-loop | A genuine `interrupt()` pause in `approvalGateNode`, not a UI banner, whenever the drafted answer quotes a `£`/`$` figure and the caller opted in (`requireApproval: true`) |
| Resume safety | `resumeApproval()` checks the checkpoint for a real pending interrupt before resuming — throws a clear error for "never existed" and "already resolved" alike, same fix as the Python repo's `resume_approval()` |
| Retrieval | Deliberately naive keyword overlap over a 4-fact in-memory corpus (`src/knowledgeBase.ts`) — the point of this repo is the graph shape, not a second vector index |
| Drafting | Real Anthropic call when `ANTHROPIC_API_KEY` is set; a deterministic offline draft otherwise, so the graph, retries, and tests all run with zero setup |

## Proven, not claimed

```
npm install
npm test                        # 8 tests, no API key or database required
```

The durable-checkpointing claim is proven the same way the Python repo proves
it — a real OS process, a real `SIGKILL`, a real second process resuming from
real Postgres:

```
createdb rfp_agent_ts   # once
npm run demo:kill-and-resume
```

What it does: starts a run, waits until the critique node has genuinely
started (meaning the draft node's checkpoint is already committed to
Postgres), sends `SIGKILL` to that process, then spawns a **second, unrelated
process** that resumes the exact same `thread_id` from the checkpoint. A
counter file proves the draft node did not re-run — the resumed process
picked up exactly where the killed one left off.

Sample output (this run's actual result, not a hand-edited transcript):

```
[orchestrator] run 1 exited — code=null signal=SIGKILL
[orchestrator] draftNode ran 1 time(s) before the kill
[runner] resumed run completed: "...data retention policy... [Source kb-4]"
[orchestrator] draftNode has run 1 time(s) total (was 1 before resume)
[orchestrator] draft was NOT re-run — the resumed process continued from the committed checkpoint.
```

## What's deliberately simplified, and why

This is a ~150-line agent file by design, not a second full RAG pipeline:

- **No vector store.** Retrieval is keyword overlap over four hardcoded facts.
  A real deployment would swap this for the same pgvector store the Python
  sibling uses — that substitution doesn't touch the graph, checkpointing, or
  interrupt logic this repo exists to prove.
- **No eval suite / CI gate.** The Python repo already carries that; there's
  no value in a second one over a four-fact corpus.
- **No OpenTelemetry tracing.** Same reasoning — one repo proving the
  observability pattern is enough; this one's job is the TS/Node parity proof.

## Layout

```
src/
  state.ts          typed graph state (Annotation.Root)
  agent.ts          the graph itself: nodes, edges, answerQuestion(), resumeApproval()
  checkpointer.ts   Postgres-or-memory, mirrors the Python repo's fallback rule
  knowledgeBase.ts  the 4-fact corpus + naive keyword retrieval
  llm.ts            real Anthropic call, or a deterministic offline draft
scripts/
  demo-kill-and-resume.ts   the real SIGKILL-and-resume demo (orchestrator)
  demo-runner.ts            child-process entrypoint the orchestrator spawns
test/
  agent.test.ts     8 tests: citation path, retry-exhaustion path, approval
                    pause/approve/reject, and resume-on-a-thread-with-nothing-
                    paused
```

## Not done

- No streaming output (the Python repo doesn't gate on this either — parity, not a gap unique to this repo)
- No MCP server exposing the retrieval tool (sprint doc's "optional, if time allows" item — not started)
