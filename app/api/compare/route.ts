import { NextResponse } from "next/server";
import { search, rankBooks } from "@/lib/qloo";
import { loadInventory, type Book } from "@/lib/inventory";
import { llmAvailable, llmOnlyPicks } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Qloo ranking + LLM-only baseline in one request

type Pick = { title: string; author: string; price: number | null; shelf: string | null; why: string };

type Attribution = { entity_id: string; score: number };

function whyFromAttribution(explain: unknown, favLabelById: Record<string, string>): string {
  const raw = (explain as any)?.["signal.interests.entities"] as Attribution[] | undefined;
  if (!raw || !raw.length) return "A match for your overall taste profile.";
  const top = [...raw]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .map((a) => favLabelById[a.entity_id])
    .filter(Boolean)
    .slice(0, 2);
  if (top.length === 0) return "A match for your overall taste profile.";
  if (top.length === 1) return `A natural fit for your love of ${top[0]}.`;
  return `A natural fit for your love of ${top[0]} and ${top[1]}.`;
}

export async function POST(req: Request) {
  const { favorites, budget } = await req.json().catch(() => ({}));
  const favs = (favorites || []).map((f: string) => f.trim()).filter(Boolean);
  if (!favs.length) return NextResponse.json({ error: "Add a few favorites first." }, { status: 400 });

  // Resolve favorites once (shared by both sides for a fair comparison).
  const signalIds: string[] = [];
  const favLabelById: Record<string, string> = {};
  const favLabels: string[] = [];
  for (const f of favs) {
    const c = await search(f, undefined, 1);
    if (c[0]) {
      signalIds.push(c[0].id);
      favLabelById[c[0].id] = c[0].name;
      favLabels.push(c[0].name);
    }
  }
  if (!signalIds.length) return NextResponse.json({ error: "Couldn't resolve those in Qloo." }, { status: 400 });

  let eligible: Book[] = (await loadInventory()).filter((b) => b.stock > 0 && b.qlooId && !b.needsReview);
  if (budget > 0) eligible = eligible.filter((b) => b.price <= budget);
  if (eligible.length === 0) return NextResponse.json({ error: "Nothing in stock fits the budget." }, { status: 400 });

  const byQloo = new Map(eligible.map((b) => [b.qlooId, b] as const));

  // Side A: Qloo taste ranking, constrained to inventory.
  const ranked = await rankBooks(
    signalIds,
    eligible.map((b) => b.qlooId!) as string[],
    eligible.length
  );
  const qloo: Pick[] = ranked
    .map((r) => ({ r, b: byQloo.get(r.id) }))
    .filter((x) => x.b)
    .slice(0, 3)
    .map(({ r, b }) => ({
      title: b!.title,
      author: b!.author,
      price: b!.price,
      shelf: b!.shelf,
      why: whyFromAttribution(r.explain, favLabelById),
    }));

  // Side B: LLM-only baseline over the same in-stock list (no Qloo ranking).
  let llm: Pick[] = [];
  if (llmAvailable()) {
    const picks = await llmOnlyPicks({
      favorites: favLabels,
      budget: budget || undefined,
      inventory: eligible.map((b) => ({ title: b.title, author: b.author })),
    });
    const findBook = (title: string) =>
      eligible.find(
        (b) => b.title.toLowerCase() === title.toLowerCase() || b.title.toLowerCase().includes(title.toLowerCase())
      );
    llm = (picks || []).map((p) => {
      const b = findBook(p.title);
      return {
        title: b?.title || p.title,
        author: b?.author || "",
        price: b?.price ?? null,
        shelf: b?.shelf ?? null,
        why: p.why,
      };
    });
  }

  return NextResponse.json({ qloo, llm, llmAvailable: llmAvailable() });
}
