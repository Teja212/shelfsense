import { NextResponse } from "next/server";
import { updateBook, type Book } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Owner-only. When OWNER_KEY is set (production), the request must carry it;
  // left unset locally so dev just works.
  const OWNER_KEY = process.env.OWNER_KEY;
  if (OWNER_KEY && req.headers.get("x-owner-key") !== OWNER_KEY) {
    return NextResponse.json({ error: "owner key required" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Partial<Book> = {};

  if ("stock" in body) patch.stock = Math.max(0, Math.floor(Number(body.stock) || 0));
  if ("price" in body) patch.price = Math.max(0, Number(body.price) || 0);
  if ("shelf" in body) patch.shelf = String(body.shelf).trim();

  // Confirming / overriding the Qloo match clears the review flag.
  if ("qlooId" in body) {
    patch.qlooId = body.qlooId ? String(body.qlooId) : null;
    patch.qlooName = body.qlooName ? String(body.qlooName) : null;
    patch.needsReview = false;
  }

  const updated = await updateBook(id, patch);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(updated);
}
