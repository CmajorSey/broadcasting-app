// 📄 ChangelogDialog.jsx
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

export default function ChangelogDialog({ open, onClose }) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>📦 What’s New in Version 0.6.2</AlertDialogTitle>
        </AlertDialogHeader>
        <div className="max-h-64 overflow-y-auto text-sm space-y-2">
         <ul className="list-disc ml-4">
 <li>🔑 Password Reset System: <code>/forgot</code> and <code>/reset</code> pages with one‑time tokens and 60‑min expiry.</li>
            <li>🧂 Secure hashing via <code>bcryptjs</code> on the backend for all new or reset passwords.</li>
            <li>🔗 New <code>POST /auth/login</code> supports both legacy plaintext and hashed passwords (backwards‑compatible).</li>
            <li>🧭 Login UI: “Forgot password?” link added; success toast + smooth redirect after login.</li>
            <li>🧩 Auth routes modularized under <code>server/routes/auth.js</code> without touching your FCM setup.</li>
</ul>


             <div className="mt-4">
            <strong className="block text-sm mb-1">🛣️ Coming Soon:</strong>
            <ul className="list-disc ml-4">
              <li><strong>v5.0.3</strong> – Production Calendar Phase 1 (seasons + proposed programs).</li>
              <li><strong>v5.0.4</strong> – Production Calendar Phase 2 (scheduling, filming/promo markers, leave visibility).</li>
              <li><strong>v5.0.5</strong> – Admin Leave Manager (balances editor + overlap awareness).</li>
              <li><strong>v1.0.0</strong> – Final polish, onboarding, go‑live 🚀</li>
            </ul>
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Dismiss</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
