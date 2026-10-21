import { redis } from "./redis";

// A/B tally for the Qloo-vs-LLM comparison. Uses Redis when configured (so a
// 5–10 person test aggregates across serverless invocations); otherwise an
// in-memory counter for local dev.

export type Tally = { qloo: number; llm: number; tie: number };

const KEYS: Record<keyof Tally, string> = {
  qloo: "shelfsense:votes:qloo",
  llm: "shelfsense:votes:llm",
  tie: "shelfsense:votes:tie",
};

const mem: Tally = { qloo: 0, llm: 0, tie: 0 };

export async function recordVote(winner: keyof Tally): Promise<Tally> {
  const r = redis();
  if (r) {
    await r.incr(KEYS[winner]);
    return getTally();
  }
  mem[winner] += 1;
  return { ...mem };
}

export async function getTally(): Promise<Tally> {
  const r = redis();
  if (r) {
    const [qloo, llm, tie] = await r.mget<(number | null)[]>(KEYS.qloo, KEYS.llm, KEYS.tie);
    return { qloo: qloo || 0, llm: llm || 0, tie: tie || 0 };
  }
  return { ...mem };
}
