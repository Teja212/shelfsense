import { loadProvenance } from "@/lib/provenance";

export const dynamic = "force-dynamic";

export default async function ProvenancePage() {
  const log = await loadProvenance();
  return (
    <main className="wrap">
      <div className="kicker">Transparency</div>
      <h1>Qloo call log</h1>
      <p className="sub">
        Every call this app makes to Qloo, newest first. This is the audit trail behind the
        &quot;from Qloo&quot; badge — nothing is invented.
      </p>

      {log.length === 0 ? (
        <div className="panel">
          <h2>No calls yet</h2>
          <p className="muted">
            Confirm a book&apos;s match on the owner page, or run a recommendation, and calls will
            appear here.
          </p>
        </div>
      ) : (
        <div className="panel">
          <h2>{log.length} recent calls</h2>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Endpoint</th>
                <th>Params</th>
                <th>Status</th>
                <th>ms</th>
                <th>results</th>
              </tr>
            </thead>
            <tbody>
              {log.map((e, i) => (
                <tr key={i}>
                  <td className="muted">{new Date(e.ts).toLocaleTimeString()}</td>
                  <td>
                    <code>{e.endpoint}</code>
                  </td>
                  <td className="muted" style={{ fontSize: 12, maxWidth: 360, wordBreak: "break-word" }}>
                    {Object.entries(e.params)
                      .map(([k, v]) => `${k}=${v}`)
                      .join("  ")}
                  </td>
                  <td>
                    <span className={"tag " + (e.status === 200 ? "ok" : "warn")}>{e.status}</span>
                  </td>
                  <td>{e.ms}</td>
                  <td>{e.resultCount ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
