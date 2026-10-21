import { NextResponse } from "next/server";
import { getTally, recordVote, type Tally } from "@/lib/votes";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getTally());
}

export async function POST(req: Request) {
  const { winner } = await req.json().catch(() => ({}));
  if (winner !== "qloo" && winner !== "llm" && winner !== "tie") {
    return NextResponse.json({ error: "winner must be qloo | llm | tie" }, { status: 400 });
  }
  return NextResponse.json(await recordVote(winner as keyof Tally));
}
