// scripts/seedChangelogToRender.mjs
import fs from "fs";
import path from "path";

const RENDER_BASE = process.env.RENDER_BASE || "https://loboard-server-backend.onrender.com";
const ACTOR = process.env.ACTOR || "Christopher Gabriel";
const FILE = process.env.FILE || "./server/data/changelog.json";

// If true: will try to avoid posting duplicates by version+date+title match (best-effort)
const DEDUPE = (process.env.DEDUPE || "1") === "1";

const readJSON = (p) => JSON.parse(fs.readFileSync(path.resolve(p), "utf8"));

const normalizeItems = (doc) => {
  if (!doc) return [];
  if (Array.isArray(doc.items)) return doc.items;
  if (Array.isArray(doc.entries)) return doc.entries;
  if (Array.isArray(doc)) return doc; // if the file itself is just an array
  return [];
};

const keyOf = (it) =>
  [
    String(it?.version || "").trim(),
    String(it?.date || "").trim(),
    String(it?.title || "").trim(),
  ].join("||");

const main = async () => {
  const localDoc = readJSON(FILE);
  const localItems = normalizeItems(localDoc);

  if (!localItems.length) {
    console.error("❌ No items found in local changelog file:", FILE);
    process.exit(1);
  }

  // Fetch existing items from Render
  const existingRes = await fetch(`${RENDER_BASE}/changelog/items`);
  const existingItems = existingRes.ok ? await existingRes.json().catch(() => []) : [];
  const existingKeys = new Set((existingItems || []).map(keyOf));

  let posted = 0;
  let skipped = 0;

  // Post oldest → newest so the latest ends up correct
  for (const item of localItems) {
    const k = keyOf(item);
    if (DEDUPE && existingKeys.has(k)) {
      skipped++;
      continue;
    }

    const res = await fetch(`${RENDER_BASE}/changelog/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-lo-user": ACTOR, // backend guard
      },
      // Support BOTH payload styles:
      // 1) { version,date,title,changes,... } direct
      // 2) { actorName, entry } style
      body: JSON.stringify({
        actorName: ACTOR,
        entry: item,
      }),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      console.error(`❌ Failed posting ${k}:`, res.status, msg);
      process.exit(1);
    }

    posted++;
  }

  console.log(`✅ Seed complete. Posted: ${posted}, Skipped: ${skipped}`);

  // Show what Render has now
  const final = await fetch(`${RENDER_BASE}/changelog`).then((r) => r.json()).catch(() => null);
  console.log("📦 Render /changelog now:", JSON.stringify(final, null, 2));
};

main().catch((e) => {
  console.error("❌ Seed script crashed:", e);
  process.exit(1);
});
