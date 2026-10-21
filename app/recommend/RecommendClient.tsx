"use client";

import { useRef, useState } from "react";
import type { AgentEvent, AgentPick } from "@/lib/agent";
import type { Thread } from "@/lib/thread";

type Step = { text: string; detail?: string };

const CAT_CLASS: Record<AgentPick["category"], string> = {
  "Close match": "cat-close",
  "Overlooked gem": "cat-gem",
  Adventurous: "cat-adv",
};

function uniqueSharedTags(thread: Thread) {
  const seen = new Set<string>();
  const out: { name: string; kind: string }[] = [];
  for (const link of thread.links) {
    for (const t of link.sharedTags) {
      const k = t.name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

const CHIPS = ["Shorter", "Less dark", "More upbeat", "Something weirder"];

export default function RecommendClient() {
  const [favorites, setFavorites] = useState<string[]>(["The Matrix", "Daft Punk", "William Gibson"]);
  const [budget, setBudget] = useState("25");
  const [preferences, setPreferences] = useState("");

  const [steps, setSteps] = useState<Step[]>([]);
  const [picks, setPicks] = useState<AgentPick[] | null>(null);
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState<string[]>([]);
  const [excludeIds, setExcludeIds] = useState<string[]>([]);
  const [started, setStarted] = useState(false);
  const traceRef = useRef<HTMLDivElement>(null);

  function setFav(i: number, v: string) {
    setFavorites((f) => f.map((x, j) => (j === i ? v : x)));
  }
  function addFav() {
    setFavorites((f) => (f.length < 6 ? [...f, ""] : f));
  }
  function removeFav(i: number) {
    setFavorites((f) => (f.length > 1 ? f.filter((_, j) => j !== i) : f));
  }

  async function stream(body: Record<string, unknown>) {
    setRunning(true);
    setSteps([]);
    setPicks(null);
    setThreads({});
    setNote(null);
    setError(null);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.body) throw new Error("No response stream.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as AgentEvent;
          if (ev.type === "step") {
            setSteps((s) => [...s, { text: ev.text, detail: ev.detail }]);
            requestAnimationFrame(() => traceRef.current?.scrollTo(0, 1e9));
          } else if (ev.type === "result") {
            setPicks(ev.picks);
            if (ev.note) setNote(ev.note);
          } else if (ev.type === "threads") {
            setThreads(ev.threads);
          } else if (ev.type === "error") {
            setError(ev.text);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setRunning(false);
    }
  }

  function baseBody(extra?: { feedback?: string[]; exclude?: string[]; justRemoved?: string }) {
    return {
      favorites: favorites.filter((f) => f.trim()),
      budget: Number(budget) || undefined,
      preferences,
      feedback: (extra?.feedback ?? feedback).join("; "),
      excludeQlooIds: extra?.exclude ?? excludeIds,
      justRemoved: extra?.justRemoved,
    };
  }

  // Fresh search from the form — clears accumulated feedback/exclusions.
  function startFresh() {
    setFeedback([]);
    setExcludeIds([]);
    setStarted(true);
    stream(baseBody({ feedback: [], exclude: [] }));
  }

  function addFeedback(chip: string) {
    if (feedback.includes(chip)) return;
    const next = [...feedback, chip];
    setFeedback(next);
    stream(baseBody({ feedback: next }));
  }

  function alreadyRead(p: AgentPick) {
    const next = [...excludeIds, p.qlooId];
    setExcludeIds(next);
    stream(baseBody({ exclude: next }));
  }

  async function markOutOfStock(p: AgentPick) {
    await fetch(`/api/inventory/${p.bookId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stock: 0 }),
    });
    stream(baseBody({ justRemoved: p.title }));
  }

  return (
    <>
      <div className="panel">
        <h2>Your favorites</h2>
        {favorites.map((f, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              className="cell"
              style={{ flex: 1, width: "auto" }}
              value={f}
              placeholder="a movie, musician, or book…"
              onChange={(e) => setFav(i, e.target.value)}
            />
            <button className="btn" onClick={() => removeFav(i)} disabled={favorites.length <= 1}>
              ✕
            </button>
          </div>
        ))}
        <button className="btn" onClick={addFav} disabled={favorites.length >= 6}>
          + add another
        </button>

        <div style={{ display: "flex", gap: 20, marginTop: 16, flexWrap: "wrap" }}>
          <label>
            <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
              Budget ($)
            </div>
            <input className="cell" type="number" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </label>
          <label style={{ flex: 1, minWidth: 220 }}>
            <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
              Anything else? (e.g. not too long, less dark)
            </div>
            <input
              className="cell"
              style={{ width: "100%" }}
              value={preferences}
              onChange={(e) => setPreferences(e.target.value)}
            />
          </label>
        </div>

        <button className="btn primary" style={{ marginTop: 18, padding: "8px 18px" }} onClick={startFresh} disabled={running}>
          {running ? "Thinking…" : "Find me a book"}
        </button>
      </div>

      {(steps.length > 0 || running) && (
        <div className="panel">
          <h2>Agent reasoning</h2>
          <div className="trace" ref={traceRef}>
            {steps.map((s, i) => (
              <div className="trace-line" key={i}>
                <span className="dot" /> {s.text}
                {s.detail && <span className="muted"> — {s.detail}</span>}
              </div>
            ))}
            {running && (
              <div className="trace-line muted">
                <span className="dot pulse" /> …
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="panel">
          <p style={{ color: "var(--bad)" }}>{error}</p>
        </div>
      )}

      {note && (
        <div className="panel">
          <p className="muted">{note}</p>
        </div>
      )}

      {picks && picks.length > 0 && (
        <>
          <div className="picks">
            {picks.map((p) => (
              <div className={"pick " + CAT_CLASS[p.category]} key={p.qlooId}>
                <div className="pick-cat">{p.category}</div>
                <div className="pick-title">{p.title}</div>
                <div className="muted">{p.author}</div>
                <div className="pick-meta">
                  <span>${p.price.toFixed(2)}</span>
                  <span className="shelf">Shelf {p.shelf}</span>
                  {typeof p.affinity === "number" && <span className="muted">affinity {p.affinity.toFixed(2)}</span>}
                </div>
                <div className="pick-why">
                  {p.why} <span className="tag ok">via Qloo</span>
                </div>
                {threads[p.qlooId] && (
                  <div className="pick-tags">
                    {(uniqueSharedTags(threads[p.qlooId]).length > 0
                      ? uniqueSharedTags(threads[p.qlooId]).slice(0, 4)
                      : threads[p.qlooId].bookTags.slice(0, 4)
                    ).map((t, i) => (
                      <span className={"chip kind-" + t.kind} key={i}>
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
                <div className="pick-actions">
                  <button className="btn" onClick={() => alreadyRead(p)} disabled={running}>
                    Already read it
                  </button>
                  <button className="btn warn" onClick={() => markOutOfStock(p)} disabled={running}>
                    Mark out of stock
                  </button>
                </div>
              </div>
            ))}
          </div>

          {picks[0] &&
            (() => {
              // Feature whichever pick has the richest thread (most shared tags).
              let hero = picks[0];
              let heroN = threads[hero.qlooId] ? uniqueSharedTags(threads[hero.qlooId]).length : -1;
              for (const p of picks) {
                const n = threads[p.qlooId] ? uniqueSharedTags(threads[p.qlooId]).length : -1;
                if (n > heroN) {
                  hero = p;
                  heroN = n;
                }
              }
              const th = threads[hero.qlooId];
              if (!th) return null;
              const shared = uniqueSharedTags(th);
              const cloud = th.mode === "tags" ? shared : th.bookTags.slice(0, 8);
              const maxW = Math.max(0.0001, ...th.links.map((l) => l.weight));
              return (
                <div className="panel thread-panel">
                  <h2>The cultural thread</h2>
                  <p className="muted" style={{ marginTop: -4 }}>
                    Why <strong style={{ color: "var(--text)" }}>{hero.title}</strong> connects to your
                    taste — {th.mode === "tags" ? "real shared tags from Qloo’s graph." : "ranked by Qloo taste affinity."}
                  </p>
                  {th.mode === "attribution" && (
                    <p className="muted" style={{ fontSize: 13 }}>
                      No shared tags surfaced for this title — the book&apos;s own vibe:
                    </p>
                  )}
                  <div className="thread-cloud">
                    {cloud.map((t, i) => (
                      <span
                        className={"chip big kind-" + t.kind}
                        key={i}
                        style={{ animationDelay: `${i * 70}ms` }}
                      >
                        {t.name}
                        <em>{t.kind}</em>
                      </span>
                    ))}
                  </div>
                  <div className="thread-links">
                    {th.links.map((l, i) => (
                      <div className="thread-link" key={i}>
                        <span className="thread-fav">{l.favorite}</span>
                        <span className="weight-bar">
                          <span style={{ width: `${Math.round((l.weight / maxW) * 100)}%` }} />
                        </span>
                        <span className="muted thread-shared">
                          {l.sharedTags.length ? l.sharedTags.map((t) => t.name).join(" · ") : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

          {started && (
            <div className="panel">
              <h2>Refine</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {CHIPS.map((c) => (
                  <button
                    key={c}
                    className={"btn" + (feedback.includes(c) ? " primary" : "")}
                    onClick={() => addFeedback(c)}
                    disabled={running}
                  >
                    {c}
                  </button>
                ))}
              </div>
              {feedback.length > 0 && (
                <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
                  Applying: {feedback.join(", ")}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
