// 📄 ChangelogDialog.jsx
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

/* ===========================
   🧾 Default dialog content (fallback)
   - Used when no backend entry is provided
   =========================== */
const DEFAULT_CHANGELOG = {
  intro: {
    textBefore: "Here’s what’s new in this update.",
    emphasis: "",
  },
  sections: [
    {
      title: "🎬 Production Calendar",
      body:
        "Production planning has started. You can now work with seasons, propose programs, and begin building schedules.",
    },
    {
      title: "📰 Newsroom Planning",
      body:
        "Newsroom planning tools are now available to help manage presenter and program schedules.",
    },
    {
      title: "🏆 Sports Planning",
      body:
        "Sports planning tools have been added to help organize sports programming and schedules.",
    },
    {
      title: "🔔 Notifications",
      body:
        "You will now receive notifications when you are assigned work or when important details change.",
    },
    {
      title: "👤 My Profile",
      body:
        "Your profile includes leave balances, leave requests, notification settings, and your personal inbox.",
    },
  ],
  callout: {
    title: "Important:",
    body:
      "Please check your profile settings and make sure notifications are enabled so you do not miss updates.",
  },
};

/* ===========================
   ✅ Backend-driven rendering
   - Pass `entry` from changelog.json (preferred)
   - Falls back to DEFAULT_CHANGELOG
   =========================== */
export default function ChangelogDialog({ open, onClose, version, entry }) {
  const shownVersion = String(version || "").trim() || "—";

  // Normalize backend entry shape safely
  const intro =
    entry?.intro ||
    (typeof entry?.description === "string" ? { text: entry.description } : null) ||
    (typeof entry?.summary === "string" ? { text: entry.summary } : null) ||
    null;

  const sections = Array.isArray(entry?.sections) ? entry.sections : DEFAULT_CHANGELOG.sections;

  const callout =
    entry?.callout ||
    (typeof entry?.beforeYouContinue === "string"
      ? { title: "Before you continue:", body: entry.beforeYouContinue }
      : DEFAULT_CHANGELOG.callout);

  const renderIntro = () => {
    // Supports either {text} or the default {textBefore, emphasis}
    if (intro?.text) return <span>{intro.text}</span>;

    const fb = DEFAULT_CHANGELOG.intro;
    return (
      <>
        {fb.textBefore}
        <div className="font-semibold inline">{fb.emphasis}</div>
      </>
    );
  };

  const renderBullets = (bullets) => {
    const list = Array.isArray(bullets) ? bullets.filter(Boolean) : [];
    if (!list.length) return null;

    return (
      <ul className="list-disc ml-5 mt-1 space-y-1">
        {list.map((b, idx) => (
          <li key={idx}>
            {String(b)
              .split("\n")
              .filter(Boolean)
              .map((line, i) => (
                <span key={i}>
                  {line}
                  {i < String(b).split("\n").filter(Boolean).length - 1 ? <br /> : null}
                </span>
              ))}
          </li>
        ))}
      </ul>
    );
  };

  const renderParagraphs = (text) => {
    const t = String(text || "").trim();
    if (!t) return null;

    // Allow "\n\n" to become separate paragraphs
    const parts = t.split("\n\n").map((p) => p.trim()).filter(Boolean);
    return parts.map((p, idx) => (
      <p key={idx} className={idx === 0 ? "mt-2" : "mt-1"}>
        {p}
      </p>
    ));
  };

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>📦 What’s New in Version {shownVersion}</AlertDialogTitle>
          <AlertDialogDescription>{renderIntro()}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="text-sm space-y-4 mt-2">
          {sections.map((sec, idx) => {
            const title = String(sec?.title || "").trim();
            const body = String(sec?.body || "").trim();
            const after = sec?.after;

            if (!title && !body && !after && !Array.isArray(sec?.bullets)) return null;

            return (
              <div key={idx}>
                {title ? <p className="font-semibold">{title}</p> : null}
                {body ? <p>{body}</p> : null}
                {renderBullets(sec?.bullets)}
                {renderParagraphs(after)}
              </div>
            );
          })}

          {callout?.body ? (
            <div className="bg-muted/40 p-3 rounded-md text-xs">
              <p className="font-semibold">{String(callout.title || "Before you continue:")}</p>
              <p>{String(callout.body)}</p>
            </div>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Dismiss</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}