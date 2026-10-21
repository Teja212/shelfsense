import { NextResponse } from "next/server";
import { resetInventory } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const OWNER_KEY = process.env.OWNER_KEY;
  if (OWNER_KEY && req.headers.get("x-owner-key") !== OWNER_KEY) {
    return NextResponse.json({ error: "owner key required" }, { status: 403 });
  }
  const count = await resetInventory();
  return NextResponse.json({ ok: true, books: count });
}
