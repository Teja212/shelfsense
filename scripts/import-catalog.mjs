// Import data/catalog.csv -> data/inventory.json.
// Universal CSV schema (title,author,isbn,price,stock,shelf) = "drops in on top
// of your existing catalog export" (Koha/Square/Shopify all export this).
//
//   node scripts/import-catalog.mjs

import { promises as fs } from "fs";
import path from "path";

const root = process.cwd();
const csvPath = path.join(root, "data", "catalog.csv");
const outPath = path.join(root, "data", "inventory.json");

function splitRow(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        q = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      q = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  const headers = splitRow(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitRow(line);
    const row = {};
    headers.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    return row;
  });
}

const text = await fs.readFile(csvPath, "utf8");
const rows = parseCSV(text);

// Preserve existing Qloo resolutions if re-importing (match on title+author).
let existing = [];
try {
  existing = JSON.parse(await fs.readFile(outPath, "utf8"));
} catch {
  /* first run */
}
const prior = new Map(existing.map((b) => [`${b.title}|${b.author}`, b]));

const books = rows.map((r, i) => {
  const was = prior.get(`${r.title}|${r.author}`);
  return {
    id: String(i + 1),
    title: r.title,
    author: r.author,
    isbn: r.isbn,
    price: Number(r.price) || 0,
    stock: Number(r.stock) || 0,
    shelf: r.shelf,
    pages: Number(r.pages) || 0,
    qlooId: was?.qlooId ?? null,
    qlooName: was?.qlooName ?? null,
    needsReview: was?.needsReview ?? false,
    candidates: was?.candidates ?? [],
  };
});

await fs.writeFile(outPath, JSON.stringify(books, null, 2), "utf8");
console.log(`Imported ${books.length} books -> data/inventory.json`);
const carried = books.filter((b) => b.qlooId).length;
if (carried) console.log(`(carried over ${carried} existing Qloo resolutions)`);
console.log(`Next: npm run resolve`);
