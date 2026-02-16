import fs from "fs";
import path from "path";

const safeJsonParse = (raw, fallback) => {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const ensureDir = (dir) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
};

const getDataDir = () => {
  const envDir = process.env.DATA_DIR;
  if (envDir) return envDir;

  // Render: persistent disk at /data (matches your index.js logic)
  if (process.env.RENDER || process.env.ON_RENDER) return "/data";

  // Local: /server/data
  return path.join(process.cwd(), "server", "data");
};

export const NEWSROOM_FILE = path.join(getDataDir(), "newsroom.json");

export function ensureNewsroomFile() {
  const dataDir = path.dirname(NEWSROOM_FILE);
  ensureDir(dataDir);

  if (!fs.existsSync(NEWSROOM_FILE)) {
    fs.writeFileSync(NEWSROOM_FILE, JSON.stringify({ weeks: {} }, null, 2));
    return;
  }

  // Normalize shape if file exists but is wrong
  const raw = fs.readFileSync(NEWSROOM_FILE, "utf-8");
  const parsed = safeJsonParse(raw, null);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !parsed.weeks) {
    fs.writeFileSync(NEWSROOM_FILE, JSON.stringify({ weeks: {} }, null, 2));
  }
}

export function readNewsroomSafe() {
  ensureNewsroomFile();
  const raw = fs.readFileSync(NEWSROOM_FILE, "utf-8");
  const parsed = safeJsonParse(raw, { weeks: {} });
  if (!parsed || typeof parsed !== "object") return { weeks: {} };
  if (!parsed.weeks || typeof parsed.weeks !== "object") return { ...parsed, weeks: {} };
  return parsed;
}

export function writeNewsroomSafe(doc) {
  ensureNewsroomFile();
  const safeDoc =
    doc && typeof doc === "object" && !Array.isArray(doc) ? doc : { weeks: {} };

  const normalized = {
    ...safeDoc,
    weeks:
      safeDoc.weeks && typeof safeDoc.weeks === "object" && !Array.isArray(safeDoc.weeks)
        ? safeDoc.weeks
        : {},
  };

  fs.writeFileSync(NEWSROOM_FILE, JSON.stringify(normalized, null, 2));
  return normalized;
}
