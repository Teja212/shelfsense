import RecommendClient from "./recommend/RecommendClient";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="wrap">
      <div className="kicker">Find your next book</div>
      <h1>Tell me what you love</h1>
      <p className="sub">
        A few movies, musicians, or books — plus your budget. The agent resolves them in Qloo,
        ranks what&apos;s on the shelf right now, and shows the cultural thread behind every pick.
      </p>
      <RecommendClient />
    </main>
  );
}
