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
          <AlertDialogTitle>📦 What’s New in Version 0.5.0</AlertDialogTitle>
        </AlertDialogHeader>
        <div className="max-h-64 overflow-y-auto text-sm space-y-2">
          <ul className="list-disc ml-4">
            <li>Postponed tickets now support new date or 'no date' option.</li>
            <li>Filming time and departure time are editable from the ticket table.</li>
            <li>Archived and deleted ticket actions (restore, delete) are fully synced with backend.</li>
            <li>Camera operator duty badges display directly on homepage carousel.</li>
            <li>New ticket sections for “My Tickets” and weekly view (Mon–Sun).</li>
            <li>Fleet system supports editing license plates and bulk delete of rentals.</li>
            <li>Week selector added to Home and Operations pages.</li>
          </ul>
          <div className="mt-4">
            <strong className="block text-sm mb-1">🛣️ Coming Soon:</strong>
            <ul className="list-disc ml-4">
              <li><strong>v5.0.1</strong> – “My Profile” page with suggestion box and leave/off day display.</li>
              <li><strong>v5.0.2</strong> – Admin notification system with backend sync and user inbox.</li>
              <li><strong>v5.0.3</strong> – Production Calendar Phase 1: seasons and proposed program scheduling.</li>
              <li><strong>v5.0.4</strong> – Production Calendar Phase 2: auto-airing, filming/promo dates, leave visibility.</li>
              <li><strong>v5.0.5</strong> – Admin leave management view with balance editor and overlap detection.</li>
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
