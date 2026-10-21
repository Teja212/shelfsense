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

export type ConstraintCandidate = {
  qlooId: string;
  title: string;
  author: string;
  price: number;
  pages: number;
  affinity: number;
};

export type ConstraintPlan = {
  hard: {
    authorsInclude?: string[];
    authorsExclude?: string[];
    excludeTitles?: string[];
    maxPrice?: number;
    maxPages?: number;
  };
  orderedQlooIds: string[];
  rationale: string;
};

/**
 * Turn a free-text request into (1) HARD constraints that must be satisfied and
 * (2) a soft preference ordering, against a fixed candidate list. The caller
 * applies the hard constraints deterministically — the model only classifies.
 */
export async function planConstraints(args: {
  favorites: string[];
  request: string;
  candidates: ConstraintCandidate[];
}): Promise<ConstraintPlan | null> {
  const system =
    "You convert a reader's extra request into hard constraints and a soft ordering, against a FIXED " +
    "candidate list. HARD = must be satisfied: authorsInclude (ONLY these authors, e.g. 'only books by " +
    "X'), authorsExclude (never these authors), excludeTitles (never these exact titles), maxPrice " +
    "(dollars), maxPages. SOFT = mood/vibe like 'shorter', 'less dark', 'lighter' — never put these in " +
    "hard; instead order candidates best-first for them in orderedQlooIds, using the given pages for " +
    "'shorter'/'longer'. Use ONLY the provided qlooIds and the author/title strings exactly as given; " +
    'never invent. Reply as JSON: {"hard": {}, "orderedQlooIds": [], "rationale": ""} — omit a hard ' +
    "field when it does not apply, include every candidate qlooId in orderedQlooIds, rationale <= 18 words.";
  const user = JSON.stringify({
    favorites: args.favorites,
    request: args.request,
    books: args.candidates.map((c) => ({
      qlooId: c.qlooId,
      title: c.title,
      author: c.author,
      price: c.price,
      pages: c.pages,
      affinity: Number(c.affinity.toFixed(3)),
    })),
  });
  const raw = await chat([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  const parsed = parseJson<ConstraintPlan>(raw);
  if (!parsed) return null;
  if (!parsed.hard || typeof parsed.hard !== "object") parsed.hard = {};
  if (!Array.isArray(parsed.orderedQlooIds)) parsed.orderedQlooIds = [];
  const valid = new Set(args.candidates.map((c) => c.qlooId));
  parsed.orderedQlooIds = parsed.orderedQlooIds.filter((id) => valid.has(id));
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
    "reader's taste. Return each book's `title` EXACTLY as it appears in the list — never invent or " +
    'reformat a title. Reply as JSON: {"picks": [{"title": string, "why": string}]}. Each why <= 25 words.';
  const user = JSON.stringify({
    favorites: args.favorites,
    budget: args.budget,
    inStock: args.inventory.map((b) => ({ title: b.title, author: b.author })),
  });
  const raw = await chat([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  const parsed = parseJson<{ picks: { title: string; why: string }[] }>(raw);
  if (!parsed || !Array.isArray(parsed.picks)) return null;
  return parsed.picks.filter((p) => p?.title).slice(0, 3);
}
