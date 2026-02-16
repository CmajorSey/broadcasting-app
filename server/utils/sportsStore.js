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

export const SPORTS_FILE = path.join(getDataDir(), "sports.json");

export function ensureSportsFile() {
  const dataDir = path.dirname(SPORTS_FILE);
  ensureDir(dataDir);

  if (!fs.existsSync(SPORTS_FILE)) {
    fs.writeFileSync(SPORTS_FILE, JSON.stringify({ weeks: {} }, null, 2));
    return;
  }

  // Normalize shape if file exists but is wrong
  const raw = fs.readFileSync(SPORTS_FILE, "utf-8");
  const parsed = safeJsonParse(raw, null);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !parsed.weeks) {
    fs.writeFileSync(SPORTS_FILE, JSON.stringify({ weeks: {} }, null, 2));
  }
}

export function readSportsSafe() {
  ensureSportsFile();
  const raw = fs.readFileSync(SPORTS_FILE, "utf-8");
  const parsed = safeJsonParse(raw, { weeks: {} });
  if (!parsed || typeof parsed !== "object") return { weeks: {} };
  if (!parsed.weeks || typeof parsed.weeks !== "object") return { ...parsed, weeks: {} };
  return parsed;
}

export function writeSportsSafe(doc) {
  ensureSportsFile();
  const safeDoc =
    doc && typeof doc === "object" && !Array.isArray(doc) ? doc : { weeks: {} };

  const normalized = {
    ...safeDoc,
    weeks:
      safeDoc.weeks && typeof safeDoc.weeks === "object" && !Array.isArray(safeDoc.weeks)
        ? safeDoc.weeks
        : {},
  };

  fs.writeFileSync(SPORTS_FILE, JSON.stringify(normalized, null, 2));
  return normalized;
}
