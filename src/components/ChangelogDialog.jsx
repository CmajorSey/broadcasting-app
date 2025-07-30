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
          <AlertDialogTitle>📦 What’s New in Version 0.6.1</AlertDialogTitle>
        </AlertDialogHeader>
        <div className="max-h-64 overflow-y-auto text-sm space-y-2">
         <ul className="list-disc ml-4">
  <li>Fixed issue where deleted tickets would reappear after page refresh.</li>
  <li>Verified persistent deletion and syncing logic using Render's file system.</li>
  <li>🚧 Deletion, restore, and archiving now fully synced to the backend.</li>
  <li>📬 My Profile v1 launched: Suggestion Box, Notifications Inbox, and Leave/Off Day Balance.</li>
  <li>Notifications can be dismissed, and toast alerts appear for new ones.</li>
  <li>Dismissed notifications persist and don’t reappear across sessions.</li>
</ul>


          <div className="mt-4">
            <strong className="block text-sm mb-1">🛣️ Coming Soon:</strong>
            <ul className="list-disc ml-4">
              <li><strong>v0.6.2</strong> – “My Profile” page with suggestion box and leave/off day display.</li>
              <li><strong>v0.6.3</strong> – Admin notification system with backend sync and user inbox.</li>
              <li><strong>v0.6.4</strong> – Production Calendar Phase 1: seasons and proposed program scheduling.</li>
              <li><strong>v0.6.5</strong> – Production Calendar Phase 2: auto-airing, filming/promo dates, leave visibility.</li>
              <li><strong>v0.6.6</strong> – Admin leave management view with balance editor and overlap detection.</li>
              <li><strong>v1.0.0</strong> – Final polish, onboarding, go live 🚀</li>
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
