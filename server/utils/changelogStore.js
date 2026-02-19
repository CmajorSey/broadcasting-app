import fs from "fs";
import path from "path";

/* ===========================
   📜 Changelog Store
   File: DATA_DIR/changelog.json
   - Uses process.env.DATA_DIR (Render/local already set in index.js)
   =========================== */

const getDataDir = () => {
  // index.js sets process.env.DATA_DIR = DATA_DIR
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
};

const getFilePath = () => path.join(getDataDir(), "changelog.json");

const defaultDoc = () => ({
  // ✅ Keep this aligned with your real current changelog baseline
  // (this value is only used if changelog.json doesn't exist yet)
  latestVersion: "0.8.5",
  items: [],
});

export const ensureChangelogFile = () => {
  try {
    const dir = getDataDir();
    const filePath = getFilePath();

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultDoc(), null, 2), "utf-8");
    }
  } catch (err) {
    console.error("ensureChangelogFile failed:", err);
  }
};

export const readChangelogSafe = () => {
  try {
    ensureChangelogFile();
    const filePath = getFilePath();
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = raw ? JSON.parse(raw) : defaultDoc();

    const latestVersion = String(parsed?.latestVersion || "").trim() || "5.0.0";
    const items = Array.isArray(parsed?.items) ? parsed.items : [];

    return { latestVersion, items };
  } catch (err) {
    console.error("readChangelogSafe failed:", err);
    return defaultDoc();
  }
};

export const writeChangelogSafe = (doc) => {
  try {
    ensureChangelogFile();
    const filePath = getFilePath();
    fs.writeFileSync(filePath, JSON.stringify(doc ?? defaultDoc(), null, 2), "utf-8");
    return true;
  } catch (err) {
    console.error("writeChangelogSafe failed:", err);
    return false;
  }
};

const safeStr = (v) => String(v ?? "").trim();

/* ===========================
   🔢 Version normalization
   - Accept: "v0.8.4" / "V0.8.4" -> "0.8.4"
   - Accept: "version 0.8.4" -> "0.8.4"
   - Leaves other strings alone
   =========================== */
const normalizeVersion = (v) => {
  const s = safeStr(v);
  if (!s) return "";

  // common prefixes
  let out = s.replace(/^version\s*/i, "").trim();
  out = out.replace(/^v\s*/i, "").trim();

  // keep only leading numeric dotted version if present
  const m = out.match(/^(\d+(?:\.\d+){0,3})/);
  return m ? m[1] : out;
};

export const normalizeEntry = (body = {}) => {
  const version = normalizeVersion(body.version);
  const date = safeStr(body.date) || new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const title = safeStr(body.title);

  const changesRaw = body.changes;
  const changes = Array.isArray(changesRaw)
    ? changesRaw.map((x) => safeStr(x)).filter(Boolean)
    : [];

  // ✅ Accept/normalize sections too (optional input)
  let sections = Array.isArray(body.sections) ? body.sections : [];

  sections = sections
    .map((s) => {
      if (!s || typeof s !== "object") return null;

      const st = safeStr(s.title);
      const sb = safeStr(s.body);
      const sa = safeStr(s.after);

      const bulletsRaw = s.bullets;
      const bullets = Array.isArray(bulletsRaw)
        ? bulletsRaw.map((b) => safeStr(b)).filter(Boolean)
        : [];

      if (!st && !sb && bullets.length === 0 && !sa) return null;

      return {
        ...(st ? { title: st } : {}),
        ...(sb ? { body: sb } : {}),
        ...(bullets.length ? { bullets } : {}),
        ...(sa ? { after: sa } : {}),
      };
    })
    .filter(Boolean);

  // ✅ Auto-build a simple section when only changes[] is provided
  if (sections.length === 0 && changes.length > 0) {
    sections = [{ title: "Changes", bullets: changes }];
  }

  // Keep optional extras if present
  const intro =
    body.intro && typeof body.intro === "object"
      ? { text: safeStr(body.intro.text) }
      : undefined;

  const callout =
    body.callout && typeof body.callout === "object"
      ? {
          ...(safeStr(body.callout.title) ? { title: safeStr(body.callout.title) } : {}),
          ...(safeStr(body.callout.body) ? { body: safeStr(body.callout.body) } : {}),
        }
      : undefined;

  return {
    version,
    date,
    title,
    ...(changes.length ? { changes } : {}),
    // ✅ ALWAYS include sections (so frontend can rely on it)
    sections,
    ...(intro?.text ? { intro } : {}),
    ...(callout?.title || callout?.body ? { callout } : {}),
  };
};

/* ===========================
   ✅ Validation
   - Require version + title
   - Require at least ONE of:
     - changes[0]
     - sections[0] (meaningful section)
   =========================== */
export const isValidEntry = (e) => {
  if (!e) return false;

  const okCore = !!(safeStr(e.version) && safeStr(e.title));
  if (!okCore) return false;

  const hasChanges = Array.isArray(e.changes) && e.changes.some((c) => safeStr(c));
  const hasSections = Array.isArray(e.sections) && e.sections.length >= 1;

  return hasChanges || hasSections;
};

