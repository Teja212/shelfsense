// Resolve each inventory book -> a Qloo entity ID, flagging low-confidence
// matches for owner review (the "Exhalation -> Ted Bundy" guard).
//
//   PowerShell:  $env:QLOO_API_KEY="..."; node scripts/resolve-inventory.mjs
//   bash/zsh:    QLOO_API_KEY="..." node scripts/resolve-inventory.mjs

import { promises as fs } from "fs";
import path from "path";

const BASE = process.env.QLOO_BASE_URL || "https://hackathon.api.qloo.com";
const KEY = process.env.QLOO_API_KEY;
const REVIEW_THRESHOLD = 0.6; // title-coverage below this => needs owner review

if (!KEY) {
  console.error("QLOO_API_KEY not set. Set it in your shell and re-run.");
  process.exit(1);
}

const dataPath = path.join(process.cwd(), "data", "inventory.json");

async function search(query) {
  const url = new URL("/search", BASE);
  url.searchParams.set("query", query);
  url.searchParams.set("types", "urn:entity:book");
  url.searchParams.set("take", "3");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { "X-Api-Key": KEY, Accept: "application/json" },
      signal: ctrl.signal,
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arr = body?.results || body?.entities || [];
    return arr.map((e) => ({ id: e.entity_id || e.id, name: e.name })).filter((e) => e.id);
  } finally {
    clearTimeout(timer);
  }
}

const norm = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

// Fraction of the TITLE's words that appear in the matched entity name.
// 1.0 = result fully covers the query title; ~0 = unrelated (Ted Bundy case).
function coverage(title, name) {
  const T = norm(title);
  if (!T.length) return 0;
  const N = new Set(norm(name));
  let m = 0;
  for (const w of T) if (N.has(w)) m++;
  return m / T.length;
}

const books = JSON.parse(await fs.readFile(dataPath, "utf8"));
let resolved = 0;
let review = 0;

for (const b of books) {
  if (b.qlooId && !b.needsReview) {
    resolved++;
    continue;
  }
  try {
    let cands = await search(b.title);
    // Retry with author if the title alone found nothing or a weak match.
    if (!cands.length || coverage(b.title, cands[0].name) < REVIEW_THRESHOLD) {
      const withAuthor = await search(`${b.title} ${b.author}`);
      if (withAuthor.length) cands = withAuthor;
    }
    b.candidates = cands.slice(0, 3).map((c) => ({ id: c.id, name: c.name }));
    if (cands.length) {
      b.qlooId = cands[0].id;
      b.qlooName = cands[0].name;
      b.needsReview = coverage(b.title, cands[0].name) < REVIEW_THRESHOLD;
      resolved++;
      if (b.needsReview) review++;
      console.log(`${b.needsReview ? "!" : "+"} ${b.title}  ->  ${cands[0].name}`);
    } else {
      b.qlooId = null;
      b.qlooName = null;
      b.needsReview = true;
      review++;
      console.log(`x ${b.title}  ->  no match`);
    }
  } catch (e) {
    b.needsReview = true;
    review++;
    console.log(`x ${b.title}  -- ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 120)); // gentle on rate limits
}

await fs.writeFile(dataPath, JSON.stringify(books, null, 2), "utf8");
console.log(`\nResolved ${resolved}/${books.length}; ${review} need owner review.`);
console.log(`Open the app to see the catalog, or run: npm run dev`);
