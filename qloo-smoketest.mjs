#!/usr/bin/env node
// Qloo de-risk smoke test for "SecondShelf"-style cross-domain book discovery.
//
// It answers four go/no-go questions BEFORE you build any UI:
//   A. Can Qloo resolve the favorites a customer would type (movies/artists/books)?
//   B. Does cross-domain taste (movies+music) surface REAL, relevant books on its own?
//   C. How much of a realistic indie-bookstore inventory does Qloo even know? (coverage)
//   D. Can it rank YOUR in-stock shortlist, with explanations that cite the favorites?
//
// Run it locally — never paste your Qloo credential into a chat, browser, or repo.
//   1) Get your event-issued hackathon key.
//   2) Windows PowerShell:  $env:QLOO_API_KEY="your-key-here"
//      macOS/Linux bash:    export QLOO_API_KEY="your-key-here"
//   3) node qloo-smoketest.mjs
//
// Needs Node 18+ (uses global fetch). No npm install required.

const API_KEY = process.env.QLOO_API_KEY;
const BASE = process.env.QLOO_BASE_URL || "https://hackathon.api.qloo.com";
const REQ_TIMEOUT_MS = 8000;
const VERBOSE = process.argv.includes("--verbose");

// ---------------------------------------------------------------------------
// EDIT THESE to match the demo you want to pitch.
// ---------------------------------------------------------------------------

// What a customer types in. Mix of domains is the whole point of the test.
const FAVORITES = [
  { query: "Interstellar", type: "urn:entity:movie" },
  { query: "Radiohead", type: "urn:entity:artist" },
  { query: "Gillian Flynn", type: "urn:entity:author" }, // "I like mysteries"
];

// A plausible ~20-title indie-bookstore inventory. Intentionally mixes
// household names with lesser-known titles to stress-test coverage honestly.
const INVENTORY = [
  "Project Hail Mary",
  "Klara and the Sun",
  "The Three-Body Problem",
  "Station Eleven",
  "Piranesi",
  "The Secret History",
  "Gone Girl",
  "The Silent Patient",
  "Tana French In the Woods",
  "Normal People",
  "A Little Life",
  "Cloud Atlas",
  "Never Let Me Go",
  "The Overstory",
  "Exhalation Ted Chiang",
  "The City We Became",
  "Mexican Gothic",
  "The Seven Husbands of Evelyn Hugo",
  "Tomorrow and Tomorrow and Tomorrow",
  "Annihilation Jeff VanderMeer",
];

// ---------------------------------------------------------------------------
// Minimal HTTP + extraction helpers (defensive about response shape).
// ---------------------------------------------------------------------------

function die(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

if (!API_KEY) {
  die(
    "QLOO_API_KEY is not set. Set it in your shell, then re-run.\n" +
      '    PowerShell:  $env:QLOO_API_KEY="your-key-here"\n' +
      '    bash/zsh:    export QLOO_API_KEY="your-key-here"'
  );
}

async function qloo(path, params) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      headers: { "X-Api-Key": API_KEY, Accept: "application/json" },
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(
      e.name === "AbortError"
        ? `timeout after ${REQ_TIMEOUT_MS}ms on ${path}`
        : `network error on ${path}: ${e.message}`
    );
  }
  clearTimeout(timer);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300);
    throw new Error(`HTTP ${res.status} on ${path} — ${detail}`);
  }
  if (VERBOSE) console.log(`\n--- raw ${path} ---\n`, JSON.stringify(body, null, 2), "\n");
  return body;
}

// Search returns candidate entities; shapes vary slightly, so be liberal.
function searchItems(body) {
  const arr = body?.results || body?.entities || (Array.isArray(body) ? body : []);
  return (arr || []).map((e) => ({
    id: e.entity_id || e.id || e.entity?.entity_id,
    name: e.name || e.entity?.name,
    types: e.types || (e.subtype ? [e.subtype] : e.type ? [e.type] : []),
    popularity: e.popularity ?? e.properties?.popularity,
  }));
}

// Insights returns ranked entities under results.entities (or results).
function insightEntities(body) {
  const arr = body?.results?.entities || body?.results || body?.entities || [];
  return (Array.isArray(arr) ? arr : []).map((e) => ({
    id: e.entity_id || e.id,
    name: e.name,
    popularity: e.popularity ?? e.properties?.popularity,
    affinity: e.query?.affinity ?? e.affinity ?? e.score,
    explain:
      e.query?.explainability ||
      e.explainability ||
      e.query?.explanation ||
      null,
    raw: e,
  }));
}

function pct(n, d) {
  return d === 0 ? "0%" : `${Math.round((100 * n) / d)}%`;
}

// ---------------------------------------------------------------------------
// The test.
// ---------------------------------------------------------------------------

const results = { A: null, B: null, C: null, D: null };

async function main() {
  console.log(`\n=== Qloo de-risk smoke test ===`);
  console.log(`host: ${BASE}`);

  // --- A. Resolve the customer's favorites -------------------------------
  console.log(`\n[A] Resolving favorites ------------------------------------`);
  const favIds = [];
  for (const f of FAVORITES) {
    try {
      // Try the typed search first, then fall back to an untyped search so a
      // wrong type guess (e.g. author vs person) doesn't look like a miss.
      let items = searchItems(await qloo("/search", { query: f.query, types: f.type, take: 3 }));
      let via = f.type;
      if (!items.length || !items[0].id) {
        items = searchItems(await qloo("/search", { query: f.query, take: 3 }));
        via = "any type";
      }
      if (items.length && items[0].id) {
        favIds.push(items[0].id);
        console.log(`  ✓ "${f.query}" (resolved via ${via})`);
        items.slice(0, 3).forEach((it, i) =>
          console.log(
            `      ${i === 0 ? "→" : " "} ${it.name}  [${(it.types || []).join(",")}]  ${it.id}`
          )
        );
      } else {
        console.log(`  ✗ "${f.query}" — no match returned (typed or untyped)`);
      }
    } catch (e) {
      console.log(`  ✗ "${f.query}" — ${e.message}`);
    }
  }
  results.A = { resolved: favIds.length, total: FAVORITES.length };
  console.log(`  A result: resolved ${favIds.length}/${FAVORITES.length} favorites`);

  if (favIds.length === 0) {
    die("No favorites resolved — cannot test the cross-domain bet. Check key/host first.");
  }

  // --- B. Open book discovery from cross-domain signals ------------------
  console.log(`\n[B] Open book recommendations from movie+music taste -------`);
  try {
    const body = await qloo("/v2/insights", {
      "filter.type": "urn:entity:book",
      "signal.interests.entities": favIds.join(","),
      "feature.explainability": "true",
      take: 8,
    });
    const books = insightEntities(body);
    results.B = { count: books.length };
    if (books.length) {
      console.log(`  ✓ Qloo returned ${books.length} books from taste signals alone:`);
      books.forEach((b, i) =>
        console.log(
          `      ${i + 1}. ${b.name || "(unnamed)"}${
            b.affinity != null ? `  affinity=${Number(b.affinity).toFixed(3)}` : ""
          }`
        )
      );
    } else {
      console.log(`  ✗ Zero books returned — the core cross-domain bet is weak here.`);
    }
  } catch (e) {
    results.B = { count: 0, error: e.message };
    console.log(`  ✗ ${e.message}`);
  }

  // --- C. Inventory coverage ---------------------------------------------
  console.log(`\n[C] Inventory coverage (does Qloo know your shelf?) --------`);
  const invIds = [];
  const misses = [];
  for (const title of INVENTORY) {
    try {
      const body = await qloo("/search", { query: title, types: "urn:entity:book", take: 1 });
      const items = searchItems(body);
      if (items.length && items[0].id) {
        invIds.push(items[0].id);
        console.log(`  ✓ ${title}  →  ${items[0].name}`);
      } else {
        misses.push(title);
        console.log(`  ✗ ${title}  — not found`);
      }
    } catch (e) {
      misses.push(title);
      console.log(`  ✗ ${title}  — ${e.message}`);
    }
  }
  results.C = { found: invIds.length, total: INVENTORY.length };
  console.log(
    `  C result: ${invIds.length}/${INVENTORY.length} titles known (${pct(
      invIds.length,
      INVENTORY.length
    )} coverage)`
  );
  if (misses.length) console.log(`           misses: ${misses.join(", ")}`);

  // --- D. Rank the in-stock shortlist, with explanations -----------------
  console.log(`\n[D] Ranking your in-stock shortlist against the favorites --`);
  if (invIds.length < 3) {
    results.D = { skipped: "too few inventory books resolved" };
    console.log(`  — skipped: need >=3 resolved inventory books, have ${invIds.length}`);
  } else {
    try {
      const body = await qloo("/v2/insights", {
        "filter.type": "urn:entity:book",
        "signal.interests.entities": favIds.join(","),
        "filter.results.entities": invIds.join(","),
        "feature.explainability": "true",
        take: Math.min(invIds.length, 10),
      });
      const ranked = insightEntities(body);
      results.D = { ranked: ranked.length, withExplain: ranked.filter((r) => r.explain).length };
      if (ranked.length) {
        console.log(`  ✓ Ranked ${ranked.length} in-stock books (Qloo's order):`);
        ranked.forEach((b, i) => {
          console.log(
            `      ${i + 1}. ${b.name || "(unnamed)"}${
              b.affinity != null ? `  affinity=${Number(b.affinity).toFixed(3)}` : ""
            }`
          );
          if (b.explain) {
            const ex = typeof b.explain === "string" ? b.explain : JSON.stringify(b.explain);
            console.log(`         why: ${ex.slice(0, 160)}`);
          }
        });
        if (results.D.withExplain === 0) {
          console.log(
            `  ⚠ No explanation payloads came back — check the exact feature.* param name in docs.`
          );
        }
      } else {
        console.log(`  ✗ Ranking returned nothing for the supplied shortlist.`);
      }
    } catch (e) {
      results.D = { error: e.message };
      console.log(`  ✗ ${e.message}`);
    }
  }

  // --- Verdict ------------------------------------------------------------
  console.log(`\n=== VERDICT ====================================================`);
  const covPct = results.C ? (results.C.found / results.C.total) * 100 : 0;
  const line = (ok, label) => console.log(`  ${ok ? "PASS" : "WEAK"}  ${label}`);
  line(results.A.resolved >= 2, `A resolve favorites            (${results.A.resolved}/${results.A.total})`);
  line((results.B?.count || 0) >= 3, `B open cross-domain discovery  (${results.B?.count || 0} books)`);
  line(covPct >= 70, `C inventory coverage           (${pct(results.C.found, results.C.total)})`);
  line((results.D?.ranked || 0) >= 3, `D rank in-stock shortlist      (${results.D?.ranked || 0} ranked)`);
  console.log(`\n  Rule of thumb: if B and C both pass, the concept is viable — build it.`);
  console.log(`  If B is weak, cross-domain taste isn't surfacing books; rethink the hook.`);
  console.log(`  If C is weak, swap in titles Qloo actually knows before the demo.\n`);
}

main().catch((e) => die(e.message));
