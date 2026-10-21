import { entityTags, type QlooTag } from "./qloo";

// Builds the "cultural thread" behind each pick: the real shared Qloo tags that
// connect a reader's favorites to the book, plus the per-favorite attribution
// weight. Falls back to attribution-only when tag overlap is thin.

export type ThreadTag = { name: string; kind: string };

export type ThreadLink = {
  favorite: string;
  weight: number; // 0..1 attribution score from Qloo explainability
  sharedTags: ThreadTag[];
};

export type Thread = {
  links: ThreadLink[];
  bookTags: ThreadTag[]; // the book's own top cultural tags (the "vibe")
  mode: "tags" | "attribution";
};

type Attr = { entity_id: string; score: number };

function dedupeByName(tags: ThreadTag[]): ThreadTag[] {
  const seen = new Set<string>();
  const out: ThreadTag[] = [];
  for (const t of tags) {
    const k = t.name.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ name: t.name.trim(), kind: t.kind });
  }
  return out;
}

export async function buildThreads(args: {
  favIds: string[];
  favLabelById: Record<string, string>;
  picks: { qlooId: string; explain?: unknown }[];
}): Promise<Record<string, Thread>> {
  const { favIds, favLabelById, picks } = args;

  // Fetch each favorite's cultural tags once.
  const favTags: Record<string, QlooTag[]> = {};
  await Promise.all(
    favIds.map(async (id) => {
      try {
        favTags[id] = await entityTags(id);
      } catch {
        favTags[id] = [];
      }
    })
  );

  const threads: Record<string, Thread> = {};
  await Promise.all(
    picks.map(async (p) => {
      let bookTags: QlooTag[] = [];
      try {
        bookTags = await entityTags(p.qlooId);
      } catch {
        bookTags = [];
      }
      const bookIds = new Set(bookTags.map((t) => t.id));

      const weightById: Record<string, number> = {};
      const attr = (p.explain as any)?.["signal.interests.entities"] as Attr[] | undefined;
      (attr || []).forEach((a) => {
        weightById[a.entity_id] = a.score;
      });

      const links: ThreadLink[] = favIds
        .map((fid) => ({
          favorite: favLabelById[fid] || "",
          weight: weightById[fid] ?? 0,
          sharedTags: dedupeByName(
            (favTags[fid] || [])
              .filter((t) => bookIds.has(t.id))
              .map((t) => ({ name: t.name, kind: t.kind }))
          ).slice(0, 6),
        }))
        .filter((l) => l.favorite)
        .sort((a, b) => b.weight - a.weight);

      const anyShared = links.some((l) => l.sharedTags.length > 0);
      threads[p.qlooId] = {
        links,
        bookTags: dedupeByName(bookTags.map((t) => ({ name: t.name, kind: t.kind }))).slice(0, 8),
        mode: anyShared ? "tags" : "attribution",
      };
    })
  );

  return threads;
}
