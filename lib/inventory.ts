import { promises as fs } from "fs";
import path from "path";
import { redis } from "./redis";

export type Book = {
  id: string;
  title: string;
  author: string;
  isbn: string;
  price: number;
  stock: number;
  shelf: string;
  // Qloo resolution (filled by scripts/resolve-inventory.mjs)
  qlooId: string | null;
  qlooName: string | null;
  needsReview: boolean;
  candidates: { id: string; name: string }[];
};

const DATA_FILE = path.join(process.cwd(), "data", "inventory.json");
const KEY = "shelfsense:inventory";

// Storage strategy:
//  - With Upstash configured (production on Vercel): the inventory lives in
//    Redis, seeded once from the committed catalog, so runtime edits persist
//    across serverless invocations.
//  - Without it (local dev / build): an in-memory cache seeded from the file.
// Either way the committed seed file is written only by the import/resolve
// scripts, never at runtime.
let memCache: Book[] | null = null;

async function readSeed(): Promise<Book[]> {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, "utf8")) as Book[];
  } catch {
    return [];
  }
}

export async function loadInventory(): Promise<Book[]> {
  const r = redis();
  if (r) {
    let data = await r.get<Book[]>(KEY);
    if (!data || !Array.isArray(data) || data.length === 0) {
      data = await readSeed();
      await r.set(KEY, data);
    }
    return data;
  }
  if (!memCache) memCache = await readSeed();
  return memCache;
}

export async function saveInventory(books: Book[]): Promise<void> {
  const r = redis();
  if (r) {
    await r.set(KEY, books);
    return;
  }
  memCache = books;
}

/** Restore the pristine committed seed — a clean slate between demos. */
export async function resetInventory(): Promise<number> {
  const seed = await readSeed();
  const r = redis();
  if (r) await r.set(KEY, seed);
  else memCache = seed;
  return seed.length;
}

export function inStock(books: Book[]): Book[] {
  return books.filter((b) => b.stock > 0 && b.qlooId && !b.needsReview);
}

export async function updateBook(id: string, patch: Partial<Book>): Promise<Book | null> {
  const books = await loadInventory();
  const i = books.findIndex((b) => b.id === id);
  if (i < 0) return null;
  books[i] = { ...books[i], ...patch };
  await saveInventory(books);
  return books[i];
}
