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
          <AlertDialogTitle>📦 What’s New in Version 0.6.0</AlertDialogTitle>
        </AlertDialogHeader>
        <div className="max-h-64 overflow-y-auto text-sm space-y-2">
          <ul className="list-disc ml-4">
            <li>Moved backend away from MongoDB and restored file-based system using Render’s persistent disk.</li>
            <li>All data (users, tickets, vehicles, rosters) now fully synced to server storage.</li>
            <li>Assigned Journalist/Producer dropdown added to ticket form, grouped by role.</li>
            <li>Assigned reporter now visible on both Ticket Page and Home Carousel views.</li>
            <li>Cam Op badges redesigned to show actual vs expected operators (e.g. 👤1🎥2).</li>
            <li>Vehicle and driver warnings added when Cam Ops are selected but missing transport.</li>
            <li>Ticket editing now supports optimistic updates with success/error toasts.</li>
            <li>Filming time and departure time editable directly in the ticket table.</li>
            <li>Archived and deleted ticket actions (restore, recycle, delete) now synced with backend.</li>
            <li>Camera operator duty badges display directly on homepage carousel.</li>
            <li>Week selector added to Home and Operations pages, with Monday as reliable week start.</li>
            <li>Changelog dialog now appears only once per version until next update.</li>
          </ul>

          <div className="mt-4">
            <strong className="block text-sm mb-1">🛣️ Coming Soon:</strong>
            <ul className="list-disc ml-4">
              <li><strong>v0.6.1</strong> – “My Profile” page with suggestion box and leave/off day display.</li>
              <li><strong>v0.6.2</strong> – Admin notification system with backend sync and user inbox.</li>
              <li><strong>v0.6.3</strong> – Production Calendar Phase 1: seasons and proposed program scheduling.</li>
              <li><strong>v0.6.4</strong> – Production Calendar Phase 2: auto-airing, filming/promo dates, leave visibility.</li>
              <li><strong>v0.6.5</strong> – Admin leave management view with balance editor and overlap detection.</li>
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
