// Server-side Qloo client. NEVER import this into a Client Component — it reads
// QLOO_API_KEY and must stay on the server (Qloo's rule: the key never ships to
// the browser). Ported from qloo-smoketest.mjs, which validated these calls.

import { logQlooCall } from "./provenance";

const BASE = process.env.QLOO_BASE_URL || "https://hackathon.api.qloo.com";
const TIMEOUT_MS = 8000;

function apiKey(): string {
  const k = process.env.QLOO_API_KEY;
  if (!k) throw new Error("QLOO_API_KEY is not set (server env).");
  return k;
}

export type QlooEntity = {
  id: string;
  name: string;
  types: string[];
  popularity?: number;
};

export type RankedBook = {
  id: string;
  name: string;
  affinity?: number;
  popularity?: number;
  explain?: unknown;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
async function qloo(
  path: string,
  params: Record<string, string | number | undefined>
): Promise<any> {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const start = Date.now();
  let status: number | "error" = "error";
  let resultCount: number | undefined;
  try {
    const res = await fetch(url, {
      headers: { "X-Api-Key": apiKey(), Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    status = res.status;
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!res.ok) {
      const d = typeof body === "string" ? body : JSON.stringify(body);
      throw new Error(`Qloo HTTP ${res.status} on ${path} — ${d.slice(0, 300)}`);
    }
    resultCount =
      body?.results?.entities?.length ??
      (Array.isArray(body?.results) ? body.results.length : undefined) ??
      (Array.isArray(body?.entities) ? body.entities.length : undefined);
    return body;
  } finally {
    clearTimeout(timer);
    await logQlooCall({
      ts: new Date().toISOString(),
      endpoint: path,
      params: Object.fromEntries(url.searchParams),
      status,
      ms: Date.now() - start,
      resultCount,
    });
  }
}

/** Resolve a free-text name to candidate Qloo entities. */
export async function search(query: string, type?: string, take = 3): Promise<QlooEntity[]> {
  const body = await qloo("/search", { query, types: type, take });
  const arr = body?.results || body?.entities || (Array.isArray(body) ? body : []);
  return (arr || [])
    .map((e: any) => ({
      id: e.entity_id || e.id,
      name: e.name,
      types: e.types || (e.subtype ? [e.subtype] : e.type ? [e.type] : []),
      popularity: e.popularity ?? e.properties?.popularity,
    }))
    .filter((e: QlooEntity) => Boolean(e.id));
}

/**
 * Rank a supplied set of in-stock book IDs against taste signals.
 * ALWAYS pass candidateIds (filter.results.entities) — unconstrained book
 * discovery skews to music/biography nonfiction (validated in the smoke test).
 */
export async function rankBooks(
  signalIds: string[],
  candidateIds: string[],
  take = 10
): Promise<RankedBook[]> {
  const body = await qloo("/v2/insights", {
    "filter.type": "urn:entity:book",
    "signal.interests.entities": signalIds.join(","),
    "filter.results.entities": candidateIds.join(","),
    "feature.explainability": "true",
    take,
  });
  const arr = body?.results?.entities || body?.results || body?.entities || [];
  return (Array.isArray(arr) ? arr : []).map((e: any) => ({
    id: e.entity_id || e.id,
    name: e.name,
    affinity: e.query?.affinity ?? e.affinity ?? e.score,
    popularity: e.popularity ?? e.properties?.popularity,
    explain: e.query?.explainability ?? e.explainability ?? null,
  }));
}

export type QlooTag = { id: string; name: string; kind: string };

// Map a tag's facet to a display "kind", keeping only cultural namespaces
// (qloo/media/music) and dropping business/place noise (place/brand). Tag ids
// look like urn:tag:<facet>:<namespace>:<slug>.
const FACET_KIND: Record<string, string> = {
  style: "mood",
  archetype: "archetype",
  character: "character",
  theme: "theme",
  keyword: "theme",
  genre: "genre",
  audience: "audience",
  subgenre: "genre",
};

function tagKind(id: string): string | null {
  const parts = id.split(":"); // ["urn","tag",facet,namespace,...]
  const facet = parts[2];
  const namespace = parts[3];
  if (!facet || !namespace) return null;
  if (namespace !== "qloo" && namespace !== "media" && namespace !== "music") return null;
  return FACET_KIND[facet] ?? "theme";
}

/** Cultural tags most associated with an entity (noise filtered out). */
export async function entityTags(entityId: string, take = 30): Promise<QlooTag[]> {
  const body = await qloo("/v2/insights", {
    "filter.type": "urn:tag",
    "signal.interests.entities": entityId,
    take,
  });
  const arr = body?.results?.tags || body?.results?.entities || body?.results || [];
  const out: QlooTag[] = [];
  for (const t of Array.isArray(arr) ? arr : []) {
    const id = t.tag_id || t.id || t.entity_id;
    if (!id) continue;
    const kind = tagKind(id);
    if (!kind) continue;
    out.push({ id, name: t.name || id, kind });
  }
  return out;
}
