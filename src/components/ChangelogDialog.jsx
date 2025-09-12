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

export default function ChangelogDialog({ open, onClose }) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>📦 What’s New in Version 0.7.0</AlertDialogTitle>
          <AlertDialogDescription>
            Updates are grouped by role so you can quickly see what matters to you.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-64 overflow-y-auto text-sm space-y-4">
          {/* --- For Everyone --- */}
          <div>
            <h3 className="font-semibold">👥 For Everyone</h3>
            <ul className="list-disc ml-4 space-y-1">
              <li>📝 Ticket forms now include new options for **EFP** and **Live** requests.</li>
              <li>📅 Public holidays are now recognized in the system, so work tracking is more accurate.</li>
              <li>💡 A new **Suggestion Box** lets you send feedback and ideas directly from your profile.</li>
              <li>📥 Notifications appear in your profile, with options to dismiss one-by-one or clear all.</li>
              <li>🕒 The top bar clock now shows seconds, with a 12h / 24h option that remembers your choice.</li>
            </ul>
          </div>

          {/* --- For Cam Ops & Drivers --- */}
          <div>
            <h3 className="font-semibold">🎥 For Camera Operators & Drivers</h3>
            <ul className="list-disc ml-4 space-y-1">
              <li>🎬 Ticket forms now clearly show when multiple Cam Ops are required, not just one.</li>
              <li>🚐 Vehicle assignments are clearer, and warnings appear when there are conflicts.</li>
              <li>🛠️ Technical requests are now separate from filming requests, so duties don’t overlap.</li>
              <li>🎖️ Duty status badges (Off Duty, Afternoon Shift, Directing News) now display consistently in tickets and on the home carousel.</li>
            </ul>
          </div>

          {/* --- For Journalists & Producers --- */}
          <div>
            <h3 className="font-semibold">📰 For Journalists & Producers</h3>
            <ul className="list-disc ml-4 space-y-1">
              <li>📝 Ticket forms now include a dropdown to assign **Journalists, Sports Journalists, or Producers** directly.</li>
              <li>📋 Assigned names appear on the Ticket Page and Home view, so everyone knows who’s responsible.</li>
              <li>🎬 Production tickets now support crew assignments (e.g. Director, A1, Graphics, etc.).</li>
            </ul>
          </div>

          {/* --- For Admins --- */}
          <div>
            <h3 className="font-semibold">🛠️ For Admins</h3>
            <ul className="list-disc ml-4 space-y-1">
              <li>⚙️ A new **Settings page** lets you manage site branding, holiday rules, and custom work-credit rules.</li>
              <li>🔔 Notifications panel now supports sending to sections, individual users, or groups for easier targeting.</li>
              <li>📊 A brand-new **Stats page** gives roster vs. reality comparisons, off-day credits, and activity breakdowns.</li>
              <li>🗂️ Technical requests now have their own sortable/archive-aware table with date filters.</li>
              <li>👤 User Management has been refined with clearer role handling and improved leave/off balances.</li>
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

