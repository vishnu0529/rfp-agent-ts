// Tiny fictional corpus so the graph has something real to retrieve from,
// same fictional client (Aldermere) as the Python sibling project, deliberately,
// so the two repos read as one consistent case study rather than two demos.
export interface KnowledgeChunk {
  id: string;
  text: string;
}

export const KNOWLEDGE_BASE: KnowledgeChunk[] = [
  {
    id: "kb-1",
    text: "Aldermere Consulting carries professional indemnity insurance cover of £5,000,000 per claim, underwritten by Hiscox.",
  },
  {
    id: "kb-2",
    text: "Aldermere Consulting's standard engagement terms require 30 days' written notice for termination without cause.",
  },
  {
    id: "kb-3",
    text: "Aldermere Consulting is ISO 27001 certified (certificate ALD-27001-0042, renewed annually).",
  },
  {
    id: "kb-4",
    text: "Aldermere Consulting's data retention policy deletes client-supplied documents 90 days after engagement close, unless the client requests earlier deletion.",
  },
];

const STOP_WORDS = new Set(["the", "a", "an", "of", "for", "is", "are", "what", "does", "do"]);

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

// Naive keyword overlap "retrieval". The point of this repo is the graph
// shape (checkpointing + interrupt), not a vector index; a real deployment
// would swap this for the same pgvector store the Python sibling uses.
export function retrieve(question: string, topK = 2): KnowledgeChunk[] {
  const qWords = keywords(question);
  const scored = KNOWLEDGE_BASE.map((chunk) => {
    const cWords = keywords(chunk.text);
    const overlap = [...qWords].filter((w) => cWords.has(w)).length;
    return { chunk, overlap };
  });
  return scored
    .filter((s) => s.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, topK)
    .map((s) => s.chunk);
}
