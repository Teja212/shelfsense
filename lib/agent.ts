import { search, rankBooks, type RankedBook } from "./qloo";
import { loadInventory, type Book } from "./inventory";
import { llmAvailable, planConstraints, groundedWhys, type ConstraintPlan } from "./llm";
import { buildThreads, type Thread } from "./thread";

// Deterministic parse of numeric limits, so "under 200 pages" / "under $15"
// hold regardless of whether the model call succeeds. Price requires a "$" so
// "under 200 pages" is never read as a price.
function parseNumeric(request: string): { maxPages?: number; maxPrice?: number } {
  const out: { maxPages?: number; maxPrice?: number } = {};
  const pg =
    request.match(
      /(?:under|below|less than|fewer than|at most|no more than|max(?:imum)?(?: of)?)\s*(\d{2,4})\s*-?\s*(?:pages?|pp)\b/i
    ) || request.match(/\b(\d{2,4})\s*(?:pages?|pp)\b\s*or\s*(?:fewer|less)/i);
  if (pg) out.maxPages = Number(pg[1]);
  const pr = request.match(
    /(?:under|below|less than|at most|no more than|cheaper than|max(?:imum)?(?: of)?)\s*\$\s*(\d{1,4})/i
  );
  if (pr) out.maxPrice = Number(pr[1]);
  return out;
}

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
  let warnUnapplied = false;

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
      yield { type: "step", text: `Set aside ${before - enriched.length} you've ruled out.` };
    }
  }

  if (enriched.length === 0) {
    yield { type: "result", picks: [], note: "That's everything in stock for your taste — restock or widen the budget." };
    return;
  }

  // 5. Turn the request into hard constraints + soft ordering. Numeric limits
  // (pages/price) are parsed deterministically so they hold even if the model
  // call fails; author/title limits come from the model. Hard constraints MUST
  // be honored — on an unrecoverable model failure we say so rather than
  // silently returning unconstrained picks.
  if (request) {
    const numeric = parseNumeric(request);
    let plan: ConstraintPlan | null = null;
    if (llmAvailable()) {
      yield { type: "step", text: `Reasoning over your request: "${request}"…` };
      try {
        plan = await planConstraints({
          favorites: favLabels,
          request,
          candidates: enriched.map((e) => ({
            qlooId: e.id,
            title: e.book.title,
            author: e.book.author,
            price: e.book.price,
            pages: e.book.pages,
            affinity: e.affinity ?? 0,
          })),
        });
      } catch {
        plan = null;
      }
    }

    const h: ConstraintPlan["hard"] = { ...(plan?.hard || {}) };
    if (numeric.maxPages != null) h.maxPages = Math.min(h.maxPages ?? Infinity, numeric.maxPages);
    if (numeric.maxPrice != null) h.maxPrice = Math.min(h.maxPrice ?? Infinity, numeric.maxPrice);

    const inc = (h.authorsInclude || []).map((s) => s.toLowerCase());
    const exc = (h.authorsExclude || []).map((s) => s.toLowerCase());
    const exTitles = (h.excludeTitles || []).map((s) => s.toLowerCase());
    const match = (a: string, list: string[]) =>
      list.some((x) => a.toLowerCase().includes(x) || x.includes(a.toLowerCase()));
    const hasHard =
      inc.length > 0 ||
      exc.length > 0 ||
      exTitles.length > 0 ||
      typeof h.maxPrice === "number" ||
      typeof h.maxPages === "number";

    if (hasHard || plan) {
      const before = enriched.length;
      let filtered = enriched.filter((e) => {
        if (inc.length && !match(e.book.author, inc)) return false;
        if (exc.length && match(e.book.author, exc)) return false;
        if (exTitles.length && match(e.book.title, exTitles)) return false;
        if (typeof h.maxPrice === "number" && e.book.price > h.maxPrice) return false;
        // Strict page limit: a book with unknown length is excluded, not slipped through.
        if (typeof h.maxPages === "number" && (!(e.book.pages > 0) || e.book.pages > h.maxPages)) return false;
        return true;
      });
      const removed = before - filtered.length;

      if (plan?.orderedQlooIds.length) {
        const order = new Map(plan.orderedQlooIds.map((id, i) => [id, i] as const));
        filtered = [...filtered].sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
      }
      enriched = filtered;

      const bits: string[] = [];
      if (inc.length) bits.push(`only ${h.authorsInclude!.join(", ")}`);
      if (exc.length) bits.push(`excluding ${h.authorsExclude!.join(", ")}`);
      if (typeof h.maxPrice === "number") bits.push(`≤ $${h.maxPrice}`);
      if (typeof h.maxPages === "number") bits.push(`≤ ${h.maxPages} pages`);
      yield {
        type: "step",
        text: bits.length
          ? `Enforced your requirements: ${bits.join("; ")}.`
          : "Adjusted the shortlist for your request.",
        detail:
          removed > 0
            ? `removed ${removed} that didn't qualify${plan?.rationale ? " · " + plan.rationale : ""}`
            : plan?.rationale || undefined,
      };
    } else if (llmAvailable() && !plan) {
      // Model failed and nothing deterministic was parsed — be honest.
      warnUnapplied = true;
      yield {
        type: "step",
        text: "(Couldn't apply your request via the model — showing taste-ranked picks; try again to enforce it.)",
      };
    } else if (!llmAvailable()) {
      yield { type: "step", text: `Noted your request: "${request}".` };
    }
  }

  if (enriched.length === 0) {
    yield { type: "result", picks: [], note: "No in-stock books match that request — try relaxing it." };
    return;
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

  yield {
    type: "result",
    picks,
    note: warnUnapplied
      ? "Your specific request couldn't be applied this run — these are taste-ranked. Try again to enforce it."
      : undefined,
  };

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
