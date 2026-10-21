import { loadInventory } from "@/lib/inventory";
import OwnerDashboard from "./OwnerDashboard";

export const dynamic = "force-dynamic";

export default async function OwnerPage() {
  const books = await loadInventory();
  return (
    <main className="wrap">
      <div className="kicker">Owner</div>
      <h1>Inventory &amp; Qloo matches</h1>
      <p className="sub">
        Edit stock, price and shelf. Confirm or fix any book&apos;s Qloo match before it reaches a
        customer — a wrong match means a wrong recommendation.
      </p>
      <OwnerDashboard initial={books} />
    </main>
  );
}
