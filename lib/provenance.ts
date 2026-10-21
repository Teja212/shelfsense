import { redis } from "./redis";

// Append-only record of every Qloo call the app/agent makes. Powers the
// "what came from Qloo" transparency view. Uses a Redis list in production
// (so it persists across serverless invocations), with an in-memory fallback
// for local dev.

export type ProvenanceEntry = {
  ts: string;
  endpoint: string;
  params: Record<string, string>;
  status: number | "error";
  ms: number;
  resultCount?: number;
};

const KEY = "shelfsense:provenance";
const MAX = 200;

let mem: ProvenanceEntry[] = [];

export async function loadProvenance(): Promise<ProvenanceEntry[]> {
  const r = redis();
  if (r) {
    try {
      const raw = await r.lrange<ProvenanceEntry | string>(KEY, 0, MAX - 1);
      return (raw || []).map((x) => (typeof x === "string" ? (JSON.parse(x) as ProvenanceEntry) : x));
    } catch {
      return [];
    }
  }
  return mem;
}

export async function logQlooCall(entry: ProvenanceEntry): Promise<void> {
  try {
    const r = redis();
    if (r) {
      await r.lpush(KEY, entry);
      await r.ltrim(KEY, 0, MAX - 1);
      return;
    }
    mem.unshift(entry);
    mem = mem.slice(0, MAX);
  } catch {
    // Logging must never break a request.
  }
}
