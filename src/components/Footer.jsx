// src/components/Footer.jsx
import pkg from "../../package.json";

// Always prefer a numeric epoch (ms) injected at build time.
// Fallback to Date.now() so dev still shows something sensible.
const version = pkg.version || "0.0.1";
const buildEpochMsRaw = import.meta.env.VITE_BUILD_EPOCH; // e.g., "1726123456789"
const buildEpochMs = Number(buildEpochMsRaw);
const effectiveEpoch = Number.isFinite(buildEpochMs) ? buildEpochMs : Date.now();

const buildDate = new Date(effectiveEpoch).toLocaleString("en-GB", {
  timeZone: "Indian/Mahe",
});

export default function Footer() {
  return (
    <footer className="mt-8 text-center text-gray-500 text-xs px-4 py-2 border-t space-y-1">
      <div>
        Version: {version} • Last Updated: {buildDate}
      </div>
      <div>Developed by Christopher Gabriel</div>
      <div>
        Built with{" "}
        <a
          href="https://render.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-blue-500"
        >
          Render
        </a>
      </div>
    </footer>
  );
}
