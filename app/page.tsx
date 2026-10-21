import { loadInventory } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export default async function Home() {
  const books = await loadInventory();
  const total = books.length;
  const resolved = books.filter((b) => b.qlooId).length;
  const review = books.filter((b) => b.needsReview).length;
  const stocked = books.filter((b) => b.stock > 0).length;

  return (
    <main className="wrap">
      <div className="kicker">Qloo Agentic Hackathon</div>
      <h1>ShelfSense</h1>
      <p className="sub">
        Turns the movies and music a reader loves into a book they can hold — from
        what&apos;s actually on the shelf.
      </p>

      <div className="stats">
        <div className="stat">
          <div className="n">{total}</div>
          <div className="l">books in catalog</div>
        </div>
        <div className="stat">
          <div className="n ok">{resolved}</div>
          <div className="l">resolved to Qloo</div>
        </div>
        <div className="stat">
          <div className={"n" + (review > 0 ? " warn" : "")}>{review}</div>
          <div className="l">need review</div>
        </div>
        <div className="stat">
          <div className="n">{stocked}</div>
          <div className="l">in stock</div>
        </div>
      </div>

      {total === 0 ? (
        <div className="panel">
          <h2>No inventory yet</h2>
          <p className="muted">
            Run <code>npm run import</code> then <code>npm run resolve</code> to populate the
            catalog and map each title to its Qloo entity.
          </p>
        </div>
      ) : (
        <div className="panel">
          <h2>Catalog &amp; Qloo resolution</h2>
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Author</th>
                <th>Shelf</th>
                <th>Stock</th>
                <th>Qloo match</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {books.map((b) => (
                <tr key={b.id}>
                  <td>{b.title}</td>
                  <td className="muted">{b.author}</td>
                  <td>{b.shelf}</td>
                  <td>{b.stock}</td>
                  <td className="muted">{b.qlooName || "—"}</td>
                  <td>
                    {!b.qlooId ? (
                      <span className="tag warn">unresolved</span>
                    ) : b.needsReview ? (
                      <span className="tag warn">review</span>
                    ) : (
                      <span className="tag ok">ok</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {review > 0 && (
        <p className="muted" style={{ fontSize: 13 }}>
          {review} match{review === 1 ? "" : "es"} flagged for review on the Owner page.
        </p>
      )}
    </main>
  );
}
