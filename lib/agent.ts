import { search, rankBooks, type RankedBook } from "./qloo";
import { loadInventory, type Book } from "./inventory";
import { llmAvailable, applyConstraints, groundedWhys } from "./llm";
import { buildThreads, type Thread } from "./thread";

// The ShelfSense agent. An async generator that yields its reasoning steps as
// it works, then a final result. Every pick is grounded in Qloo data and real
// inventory. Qloo provides the taste ranking; the LLM (if configured) only
// applies the reader's soft constraints and phrases the reasons.

export type AgentInput = {
  favorites: string[];
  budget?: number;
  preferences?: string;
  feedback?: string; // accumulated feedback from the chips
  excludeQlooIds?: string[]; // "already read it"
  justRemoved?: string; // title just marked out of stock (for the trace)
};

export type AgentPick = {
  category: "Close match" | "Overlooked gem" | "Adventurous";
  title: string;
  author: string;
  price: number;
  shelf: string;
  affinity?: number;
  why: string;
  qlooId: string;
  bookId: string;
  drivers?: string[];
};

export type AgentEvent =
  | { type: "step"; text: string; detail?: string }
  | { type: "result"; picks: AgentPick[]; note?: string }
  | { type: "threads"; threads: Record<string, Thread> }
  | { type: "error"; text: string };

const typeLabel = (types: string[]) => (types[0] || "").split(":").pop() || "item";

type Attribution = { entity_id: string; score: number };

function topDrivers(pick: RankedBook, favLabelById: Record<string, string>): string[] {
  const raw = (pick.explain as any)?.["signal.interests.entities"] as Attribution[] | undefined;
  if (!raw || !raw.length) return [];
  return [...raw]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .map((a) => favLabelById[a.entity_id])
    .filter(Boolean)
    .slice(0, 2);
}

function deterministicWhy(drivers: string[]): string {
  if (drivers.length === 0) return "A match for your overall taste profile.";
  if (drivers.length === 1) return `A natural fit for your love of ${drivers[0]}.`;
  return `A natural fit for your love of ${drivers[0]} and ${drivers[1]}.`;
}

type Enriched = RankedBook & { book: Book };

function selectPicks(ranked: Enriched[], favLabelById: Record<string, string>): AgentPick[] {
  const n = ranked.length;
  if (n === 0) return [];

  const hasPop = ranked.some((r) => typeof r.popularity === "number");
  const makePick = (e: Enriched, category: AgentPick["category"]): AgentPick => {
    const drivers = topDrivers(e, favLabelById);
    return {
      category,
      title: e.book.title,
      author: e.book.author,
      price: e.book.price,
      shelf: e.book.shelf,
      affinity: e.affinity,
      why: deterministicWhy(drivers),
      qlooId: e.id,
      bookId: e.book.id,
      drivers,
    };
  };

  const used = new Set<string>();
  const take = (e: Enriched | undefined) => {
    if (e && !used.has(e.book.id)) {
      used.add(e.book.id);
      return e;
    }
    return undefined;
  };

  const out: AgentPick[] = [];

  const close = take(ranked[0]);
  if (close) out.push(makePick(close, "Close match"));

  const topBand = ranked.slice(1, Math.max(2, Math.ceil(n * 0.6)));
  let overlooked: Enriched | undefined;
  if (hasPop) {
    overlooked = [...topBand]
      .filter((e) => !used.has(e.book.id))
      .sort((a, b) => (a.popularity ?? 1) - (b.popularity ?? 1))[0];
  }
  overlooked = take(overlooked) || take(topBand.find((e) => !used.has(e.book.id)));
  if (overlooked) out.push(makePick(overlooked, "Overlooked gem"));

  const lowerBand = ranked.slice(Math.floor(n * 0.6));
  const adventurous =
    take(lowerBand.find((e) => !used.has(e.book.id))) ||
    take(ranked.find((e) => !used.has(e.book.id)));
  if (adventurous) out.push(makePick(adventurous, "Adventurous"));

  return out;
}

export async function* runAgent(input: AgentInput): AsyncGenerator<AgentEvent> {
  const favorites = (input.favorites || []).map((f) => f.trim()).filter(Boolean);
  const budget = input.budget && input.budget > 0 ? input.budget : undefined;
  const request = [input.preferences, input.feedback]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join("; ");

  if (input.justRemoved) {
    yield { type: "step", text: `"${input.justRemoved}" is out of stock — re-planning from what's on the shelf…` };
  }

  if (favorites.length === 0) {
    yield { type: "error", text: "Tell me a few things you love first (movies, music, books)." };
    return;
  }

  // 1. Resolve favorites to Qloo entities, with visible disambiguation.
  const signalIds: string[] = [];
  const favLabelById: Record<string, string> = {};
  const favLabels: string[] = [];
  for (const fav of favorites) {
    const cands = await search(fav, undefined, 3);
    if (!cands.length) {
      yield { type: "step", text: `Couldn't place "${fav}" in Qloo — skipping it.` };
      continue;
    }
    const chosen = cands[0];
    signalIds.push(chosen.id);
    favLabelById[chosen.id] = chosen.name;
    favLabels.push(chosen.name);
    const alt = cands.find((c) => c.name.toLowerCase() !== chosen.name.toLowerCase());
    yield {
      type: "step",
      text: `Resolved "${fav}" → ${chosen.name} (${typeLabel(chosen.types)})`,
      detail: alt ? `picked it over "${alt.name}"` : undefined,
    };
  }

  if (signalIds.length === 0) {
    yield { type: "error", text: "I couldn't resolve any of those in Qloo. Try different titles." };
    return;
  }

  // 2. Eligible = real, confirmed, in-stock, within budget.
  const books = await loadInventory();
  let eligible = books.filter((b) => b.stock > 0 && b.qlooId && !b.needsReview);
  yield { type: "step", text: `${eligible.length} books in stock and matched to Qloo.` };

  if (budget) {
    const before = eligible.length;
    eligible = eligible.filter((b) => b.price <= budget);
    yield {
      type: "step",
      text: `Keeping the ${eligible.length} under your $${budget} budget.`,
      detail: before > eligible.length ? `(dropped ${before - eligible.length} over budget)` : undefined,
    };
  }

  if (eligible.length === 0) {
    yield { type: "result", picks: [], note: "Nothing in stock fits those constraints — try a higher budget." };
    return;
  }

  // 3. Rank the eligible books against the taste signals (constrained to inventory).
  const candidateIds = eligible.map((b) => b.qlooId!) as string[];
  yield { type: "step", text: `Asking Qloo to rank those ${candidateIds.length} against your taste…` };
  const ranked = await rankBooks(signalIds, candidateIds, candidateIds.length);

  const byQlooId = new Map(eligible.map((b) => [b.qlooId, b] as const));
  let enriched: Enriched[] = ranked
    .map((r) => ({ ...r, book: byQlooId.get(r.id)! }))
    .filter((e) => e.book)
    .sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0));

  if (enriched.length === 0) {
    yield { type: "result", picks: [], note: "Qloo returned no ranking for those books." };
    return;
  }

  // 4. Drop anything the reader has already read.
  if (input.excludeQlooIds?.length) {
    const ex = new Set(input.excludeQlooIds);
    const before = enriched.length;
    enriched = enriched.filter((e) => !ex.has(e.id));
    if (before > enriched.length) {
      yield { type: "step", text: `Set aside ${before - enriched.length} you've already read.` };
    }
  }

  if (enriched.length === 0) {
    yield { type: "result", picks: [], note: "That's everything in stock for your taste — restock or widen the budget." };
    return;
  }

  // 5. Apply the reader's soft constraints with the LLM (if configured).
  if (request) {
    if (llmAvailable()) {
      yield { type: "step", text: `Reasoning over your request: "${request}"…` };
      try {
        const r = await applyConstraints({
          favorites: favLabels,
          request,
          candidates: enriched.map((e) => ({
            qlooId: e.id,
            title: e.book.title,
            author: e.book.author,
            affinity: e.affinity ?? 0,
          })),
        });
        if (r) {
          const order = new Map(r.orderedQlooIds.map((id, i) => [id, i] as const));
          enriched = [...enriched].sort(
            (a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999)
          );
          yield { type: "step", text: "Adjusted the shortlist for your request.", detail: r.rationale };
        }
      } catch {
        yield { type: "step", text: "(Couldn't apply that via the model — using the taste ranking as-is.)" };
      }
    } else {
      yield { type: "step", text: `Noted your request: "${request}".` };
    }
  }

  yield { type: "step", text: "Picking a close match, an overlooked gem, and a wildcard." };
  const picks = selectPicks(enriched, favLabelById);

  // 6. Grounded reasons (LLM phrasing over Qloo attribution; deterministic otherwise).
  if (llmAvailable() && picks.length) {
    try {
      const whys = await groundedWhys(
        picks.map((p) => ({ qlooId: p.qlooId, title: p.title, drivers: p.drivers || [] }))
      );
      if (whys) {
        for (const p of picks) if (whys[p.qlooId]) p.why = whys[p.qlooId];
        yield { type: "step", text: "Wrote a grounded reason for each pick." };
      }
    } catch {
      /* keep deterministic reasons */
    }
  }

  yield { type: "result", picks };

  // 7. The cultural thread — the real shared Qloo tags linking the favorites to
  // each pick. Streamed after the picks so it animates in as a reveal.
  if (picks.length) {
    yield { type: "step", text: "Tracing the cultural threads behind each pick…" };
    try {
      const byId = new Map(enriched.map((e) => [e.id, e] as const));
      const threads = await buildThreads({
        favIds: signalIds,
        favLabelById,
        picks: picks.map((p) => ({ qlooId: p.qlooId, explain: byId.get(p.qlooId)?.explain })),
      });
      yield { type: "threads", threads };
    } catch {
      // The thread is a bonus; never fail the run over it.
    }
  }
}
