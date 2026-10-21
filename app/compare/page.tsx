import CompareClient from "./CompareClient";

export const dynamic = "force-dynamic";

export default function ComparePage() {
  return (
    <main className="wrap">
      <div className="kicker">Evidence</div>
      <h1>Qloo vs. LLM-only — blind test</h1>
      <p className="sub">
        Same reader, same in-stock shelf. One column is ranked by Qloo&apos;s taste graph; the other
        by the language model alone. You don&apos;t see which is which — pick the better set, then
        reveal. Run it past 5–10 people to see if the taste layer actually earns its place.
      </p>
      <CompareClient />
    </main>
  );
}
