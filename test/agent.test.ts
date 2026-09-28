import { describe, it, expect, beforeEach } from "vitest";
import { answerQuestion, resumeApproval } from "../src/agent.js";

// No ANTHROPIC_API_KEY in the test environment on purpose — every test below
// exercises the real graph (retrieval, retry routing, checkpointing,
// interrupt/resume) against the deterministic offline draft path in llm.ts,
// not a mock of the graph itself.
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe("answerQuestion", () => {
  it("answers a question the corpus covers, with a citation, no retries", async () => {
    const result = await answerQuestion("What is Aldermere's professional indemnity insurance cover?");
    expect(result.citedChunkId).toBe("kb-1");
    expect(result.answer).toContain("[Source kb-1]");
    expect(result.retries).toBe(0);
    expect(result.pendingApproval).toBe(false);
    expect(result.approvalStatus).toBe("not_required");
  });

  it("retries up to maxRetries then gives up on a question the corpus can't answer", async () => {
    const result = await answerQuestion("What is the CEO's home address?", { maxRetries: 2 });
    expect(result.citedChunkId).toBeNull();
    expect(result.retries).toBe(2);
    expect(result.pendingApproval).toBe(false);
  });

  it("pauses at the approval gate when the answer quotes a commercial figure", async () => {
    const result = await answerQuestion("What is Aldermere's professional indemnity insurance cover?", {
      requireApproval: true,
    });
    expect(result.pendingApproval).toBe(true);
    expect(result.approvalStatus).toBe("pending");
    expect(result.answer).toBeNull(); // nothing is released while paused
  });

  it("does not pause when require_approval is on but the answer has no figure", async () => {
    const result = await answerQuestion("What is Aldermere's data retention policy?", {
      requireApproval: true,
    });
    expect(result.pendingApproval).toBe(false);
    expect(result.approvalStatus).toBe("not_required");
    expect(result.answer).not.toBeNull();
  });
});

describe("resumeApproval", () => {
  it("releases the answer once approved", async () => {
    const paused = await answerQuestion("What is Aldermere's professional indemnity insurance cover?", {
      requireApproval: true,
    });
    expect(paused.pendingApproval).toBe(true);

    const resumed = await resumeApproval(paused.threadId, true);
    expect(resumed.pendingApproval).toBe(false);
    expect(resumed.approvalStatus).toBe("approved");
    expect(resumed.answer).toContain("[Source kb-1]");
  });

  it("withholds the answer permanently once rejected", async () => {
    const paused = await answerQuestion("What is Aldermere's professional indemnity insurance cover?", {
      requireApproval: true,
    });

    const resumed = await resumeApproval(paused.threadId, false);
    expect(resumed.pendingApproval).toBe(false);
    expect(resumed.approvalStatus).toBe("rejected");
    expect(resumed.answer).toBeNull();
  });

  it("throws rather than silently no-op'ing on a thread with nothing paused", async () => {
    const finished = await answerQuestion("What is Aldermere's data retention policy?");
    await expect(resumeApproval(finished.threadId, true)).rejects.toThrow(/No pending approval/);
  });

  it("throws for a thread_id that never existed", async () => {
    await expect(resumeApproval("no-such-thread", true)).rejects.toThrow(/No pending approval/);
  });
});
