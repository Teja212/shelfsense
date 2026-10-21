"use client";

import { useEffect, useState } from "react";

type Pick = { title: string; author: string; price: number | null; shelf: string | null; why: string };
type Tally = { qloo: number; llm: number; tie: number };

export default function CompareClient() {
  const [favorites, setFavorites] = useState("Interstellar, Radiohead, Gillian Flynn");
  const [budget, setBudget] = useState("25");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // leftIsQloo randomizes which column is Qloo, hidden until reveal.
  const [data, setData] = useState<{ left: Pick[]; right: Pick[]; leftIsQloo: boolean } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [tally, setTally] = useState<Tally | null>(null);

  useEffect(() => {
    fetch("/api/compare/vote")
      .then((r) => r.json())
      .then(setTally)
      .catch(() => {});
  }, []);

  async function run() {
    setLoading(true);
    setError(null);
    setData(null);
    setRevealed(false);
    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          favorites: favorites.split(",").map((s) => s.trim()).filter(Boolean),
          budget: Number(budget) || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Comparison failed.");
      if (!json.llmAvailable) throw new Error("DeepSeek key not set — the LLM baseline is unavailable.");
      const leftIsQloo = Math.random() < 0.5;
      setData({
        left: leftIsQloo ? json.qloo : json.llm,
        right: leftIsQloo ? json.llm : json.qloo,
        leftIsQloo,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function vote(side: "left" | "right" | "tie") {
    if (!data) return;
    let winner: keyof Tally = "tie";
    if (side === "left") winner = data.leftIsQloo ? "qloo" : "llm";
    else if (side === "right") winner = data.leftIsQloo ? "llm" : "qloo";
    setRevealed(true);
    try {
      const res = await fetch("/api/compare/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ winner }),
      });
      setTally(await res.json());
    } catch {
      /* ignore */
    }
  }

  function column(picks: Pick[], isQloo: boolean, label: string) {
    return (
      <div className="panel" style={{ flex: 1, minWidth: 260 }}>
        <h2>
          {label}
          {revealed && (
            <span className={"tag " + (isQloo ? "ok" : "warn")} style={{ marginLeft: 8 }}>
              {isQloo ? "Qloo" : "LLM-only"}
            </span>
          )}
        </h2>
        {picks.length === 0 && <p className="muted">No picks returned.</p>}
        {picks.map((p, i) => (
          <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 600 }}>{p.title}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              {p.author}
              {p.price != null && ` · $${p.price.toFixed(2)}`}
              {p.shelf && ` · Shelf ${p.shelf}`}
            </div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{p.why}</div>
          </div>
        ))}
      </div>
    );
  }

  const total = tally ? tally.qloo + tally.llm + tally.tie : 0;

  return (
    <>
      <div className="panel">
        <label>
          <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
            Favorites (comma-separated)
          </div>
          <input className="cell" style={{ width: "100%" }} value={favorites} onChange={(e) => setFavorites(e.target.value)} />
        </label>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-end", marginTop: 12 }}>
          <label>
            <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
              Budget ($)
            </div>
            <input className="cell" type="number" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </label>
          <button className="btn primary" style={{ padding: "8px 18px" }} onClick={run} disabled={loading}>
            {loading ? "Comparing…" : "Run blind comparison"}
          </button>
        </div>
        {error && <p style={{ color: "var(--bad)", marginTop: 12 }}>{error}</p>}
      </div>

      {data && (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {column(data.left, data.leftIsQloo, "Option A")}
            {column(data.right, !data.leftIsQloo, "Option B")}
          </div>
          <div className="panel">
            <h2>Which set would you rather be handed?</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn" onClick={() => vote("left")} disabled={revealed}>
                A is better
              </button>
              <button className="btn" onClick={() => vote("tie")} disabled={revealed}>
                About the same
              </button>
              <button className="btn" onClick={() => vote("right")} disabled={revealed}>
                B is better
              </button>
            </div>
            {revealed && (
              <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
                Revealed above. Run another to keep the tally going.
              </p>
            )}
          </div>
        </>
      )}

      {tally && total > 0 && (
        <div className="panel">
          <h2>Tally so far ({total} votes)</h2>
          <div className="stats">
            <div className="stat">
              <div className="n ok">{tally.qloo}</div>
              <div className="l">preferred Qloo</div>
            </div>
            <div className="stat">
              <div className="n warn">{tally.llm}</div>
              <div className="l">preferred LLM-only</div>
            </div>
            <div className="stat">
              <div className="n">{tally.tie}</div>
              <div className="l">about the same</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
