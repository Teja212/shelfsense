import { NextResponse } from "next/server";
import { loadInventory } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export async function GET() {
  const books = await loadInventory();
  return NextResponse.json({
    ok: true,
    service: "shelfsense",
    qlooKeyPresent: Boolean(process.env.QLOO_API_KEY),
    catalog: books.length,
    resolved: books.filter((b) => b.qlooId).length,
    ts: new Date().toISOString(),
  });
}
