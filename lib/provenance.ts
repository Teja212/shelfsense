import { promises as fs } from "fs";
import path from "path";

// Append-only record of every Qloo call the app/agent makes. Powers the
// "what came from Qloo" badge and the transparency the judges look for.

export type ProvenanceEntry = {
  ts: string;
  endpoint: string;
  params: Record<string, string>;
  status: number | "error";
  ms: number;
  resultCount?: number;
};

const FILE = path.join(process.cwd(), "data", "provenance.json");
const MAX = 200;

export async function loadProvenance(): Promise<ProvenanceEntry[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as ProvenanceEntry[];
  } catch {
    return [];
  }
}

export async function logQlooCall(entry: ProvenanceEntry): Promise<void> {
  try {
    const log = await loadProvenance();
    log.unshift(entry);
    await fs.writeFile(FILE, JSON.stringify(log.slice(0, MAX), null, 2), "utf8");
  } catch {
    // Logging must never break a request.
  }
}
