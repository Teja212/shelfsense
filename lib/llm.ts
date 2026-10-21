// DeepSeek LLM layer (OpenAI-compatible). Used for two jobs only:
//   1. apply a reader's soft constraints to a Qloo-ranked shortlist
//   2. write a grounded one-line reason per pick
// Qloo remains the taste signal; the LLM never invents books or facts.
// If no key is set, callers fall back to deterministic behavior.

const BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

export function llmAvailable(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

type Msg = { role: "system" | "user" | "assistant"; content: string };

async function chat(messages: Msg[], timeoutMs = 20000): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY not set");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`DeepSeek HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

function parseJson<T>(raw: string): T | null {
  const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

export type ConstraintCandidate = { qlooId: string; title: string; author: string; affinity: number };

/** Reorder/demote a Qloo-ranked shortlist to honor a free-text request. */
export async function applyConstraints(args: {
  favorites: string[];
  request: string;
  candidates: ConstraintCandidate[];
}): Promise<{ orderedQlooIds: string[]; rationale: string } | null> {
  const system =
    "You are a bookseller's assistant. You receive books already ranked by a reader's taste " +
    "(higher affinity = stronger taste match) and the reader's extra request. Reorder the list so " +
    "books that best honor the request come first (e.g. 'shorter' prefers shorter books, 'less dark' " +
    "prefers lighter ones, 'already read X' sends X to the end). Keep taste affinity as the tie-breaker. " +
    "Use ONLY the given books and their qlooId values; never invent titles. " +
    'Reply as JSON: {"orderedQlooIds": string[], "rationale": string}. Rationale <= 18 words.';
  const user = JSON.stringify({
    favorites: args.favorites,
    request: args.request,
    books: args.candidates.map((c) => ({
      qlooId: c.qlooId,
      title: c.title,
      author: c.author,
      affinity: Number(c.affinity.toFixed(3)),
    })),
  });
  const raw = await chat([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  const parsed = parseJson<{ orderedQlooIds: string[]; rationale: string }>(raw);
  if (!parsed || !Array.isArray(parsed.orderedQlooIds)) return null;
  const valid = new Set(args.candidates.map((c) => c.qlooId));
  parsed.orderedQlooIds = parsed.orderedQlooIds.filter((id) => valid.has(id));
  if (!parsed.orderedQlooIds.length) return null;
  return parsed;
}

/** One grounded sentence per pick, referencing only the linked favorites. */
export async function groundedWhys(
  picks: { qlooId: string; title: string; drivers: string[] }[]
): Promise<Record<string, string> | null> {
  const system =
    "You write one short reason (<= 25 words) a bookseller gives for each recommended book. " +
    "You are given each book's title and the reader favorites that a taste graph linked to it. " +
    "Reference that connection warmly. Do NOT describe the book's plot, themes, or make any factual " +
    'claim about its content. Reply as JSON: {"whys": [{"qlooId": string, "why": string}]}.';
  const user = JSON.stringify({ picks });
  const raw = await chat([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  const parsed = parseJson<{ whys: { qlooId: string; why: string }[] }>(raw);
  if (!parsed || !Array.isArray(parsed.whys)) return null;
  const out: Record<string, string> = {};
  for (const w of parsed.whys) if (w?.qlooId && w?.why) out[w.qlooId] = w.why.trim();
  return Object.keys(out).length ? out : null;
}

/**
 * LLM-only baseline for the A/B test: recommend 3 books from the in-stock list
 * using the model's own judgment, WITHOUT Qloo's taste ranking.
 */
export async function llmOnlyPicks(args: {
  favorites: string[];
  budget?: number;
  inventory: { title: string; author: string }[];
}): Promise<{ title: string; why: string }[] | null> {
  const system =
    "You are a bookseller. From ONLY the provided in-stock list, choose the 3 best books for this " +
    "reader's taste. Use only titles that appear in the list — never invent one. " +
    'Reply as JSON: {"picks": [{"title": string, "why": string}]}. Each why <= 25 words.';
  const user = JSON.stringify({
    favorites: args.favorites,
    budget: args.budget,
    inStock: args.inventory.map((b) => `${b.title} — ${b.author}`),
  });
  const raw = await chat([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  const parsed = parseJson<{ picks: { title: string; why: string }[] }>(raw);
  if (!parsed || !Array.isArray(parsed.picks)) return null;
  return parsed.picks.filter((p) => p?.title).slice(0, 3);
}
