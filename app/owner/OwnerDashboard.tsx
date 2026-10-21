"use client";

import { Fragment, useState } from "react";
import type { Book } from "@/lib/inventory";

type Candidate = { id: string; name: string };

export default function OwnerDashboard({ initial }: { initial: Book[] }) {
  const [books, setBooks] = useState<Book[]>(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [cands, setCands] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);

  const reviewCount = books.filter((b) => b.needsReview || !b.qlooId).length;

  function setLocal(id: string, patch: Partial<Book>) {
    setBooks((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  async function patch(id: string, body: Partial<Book>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/inventory/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) setLocal(id, await res.json());
    } finally {
      setBusy(false);
    }
  }

  function openResolve(b: Book) {
    setOpenId(b.id);
    setQuery(b.title);
    setCands(b.candidates || []);
  }

  async function research() {
    setBusy(true);
    try {
      const res = await fetch(`/api/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      setCands(data.candidates || []);
    } finally {
      setBusy(false);
    }
  }

  async function pick(id: string, c: Candidate) {
    await patch(id, { qlooId: c.id, qlooName: c.name });
    setOpenId(null);
  }

  async function resetDemo() {
    setBusy(true);
    try {
      await fetch("/api/reset", { method: "POST" });
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" aria-busy={busy}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ marginBottom: 0 }}>
          {books.length} books · {reviewCount} need attention
        </h2>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={resetDemo} disabled={busy}>
          Reset demo data
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Shelf</th>
            <th>Price</th>
            <th>Stock</th>
            <th>Qloo match</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {books.map((b) => (
            <Fragment key={b.id}>
              <tr className={b.stock === 0 ? "row-dim" : ""}>
                <td>
                  <div>{b.title}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {b.author}
                  </div>
                </td>
                <td>
                  <input
                    className="cell shelf"
                    value={b.shelf}
                    onChange={(e) => setLocal(b.id, { shelf: e.target.value })}
                    onBlur={() => patch(b.id, { shelf: b.shelf })}
                  />
                </td>
                <td>
                  <input
                    className="cell"
                    type="number"
                    step="0.01"
                    value={b.price}
                    onChange={(e) => setLocal(b.id, { price: Number(e.target.value) })}
                    onBlur={() => patch(b.id, { price: b.price })}
                  />
                </td>
                <td>
                  <input
                    className="cell"
                    type="number"
                    min={0}
                    value={b.stock}
                    onChange={(e) => setLocal(b.id, { stock: Number(e.target.value) })}
                    onBlur={() => patch(b.id, { stock: b.stock })}
                  />{" "}
                  <button
                    className={"btn" + (b.stock > 0 ? " warn" : "")}
                    onClick={() => patch(b.id, { stock: b.stock > 0 ? 0 : 1 })}
                  >
                    {b.stock > 0 ? "Out of stock" : "Restock"}
                  </button>
                </td>
                <td className="muted">
                  {b.qlooName || "—"}{" "}
                  {!b.qlooId ? (
                    <span className="tag warn">unresolved</span>
                  ) : b.needsReview ? (
                    <span className="tag warn">review</span>
                  ) : (
                    <span className="tag ok">ok</span>
                  )}
                </td>
                <td>
                  <button className="btn" onClick={() => (openId === b.id ? setOpenId(null) : openResolve(b))}>
                    {openId === b.id ? "Close" : "Confirm / fix"}
                  </button>
                </td>
              </tr>
              {openId === b.id && (
                <tr>
                  <td colSpan={6}>
                    <div className="resolve">
                      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                        <input
                          className="cell"
                          style={{ width: 280 }}
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Search Qloo for the right book…"
                        />
                        <button className="btn" onClick={research} disabled={busy}>
                          Search Qloo
                        </button>
                      </div>
                      {cands.length === 0 ? (
                        <div className="muted" style={{ fontSize: 13 }}>
                          No candidates yet — search above.
                        </div>
                      ) : (
                        cands.map((c) => (
                          <div className="cand" key={c.id}>
                            <span>
                              {c.name}{" "}
                              {c.id === b.qlooId && <span className="tag ok">current</span>}
                            </span>
                            <button className="btn primary" onClick={() => pick(b.id, c)} disabled={busy}>
                              Use this
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
