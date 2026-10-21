import { NextResponse } from "next/server";
import { search } from "@/lib/qloo";

export const dynamic = "force-dynamic";

// Owner-triggered Qloo search when confirming/fixing a book's match.
export async function POST(req: Request) {
  const { query } = await req.json().catch(() => ({ query: "" }));
  const q = String(query || "").trim();
  if (!q) return NextResponse.json({ candidates: [] });
  try {
    const results = await search(q, "urn:entity:book", 5);
    return NextResponse.json({
      candidates: results.map((r) => ({ id: r.id, name: r.name })),
    });
  } catch (e) {
    return NextResponse.json(
      { candidates: [], error: e instanceof Error ? e.message : "search failed" },
      { status: 502 }
    );
  }
}
