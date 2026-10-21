import { NextResponse } from "next/server";
import { resetInventory } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export async function POST() {
  const count = await resetInventory();
  return NextResponse.json({ ok: true, books: count });
}
