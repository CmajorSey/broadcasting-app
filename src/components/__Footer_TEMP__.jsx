// src/components/Footer.jsx
import pkg from "../../package.json";

const version = pkg.version || "0.0.1";
const buildDate = process.env.BUILD_DATE || "unknown";

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
