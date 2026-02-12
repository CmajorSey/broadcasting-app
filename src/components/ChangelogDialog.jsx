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

import { APP_VERSION } from "@/version";

export default function ChangelogDialog({ open, onClose }) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>📦 What’s New in Version {APP_VERSION}</AlertDialogTitle>
          <AlertDialogDescription>
            Lo Board is now fully connected and ready for daily use of user <p className="font-semibold">testing.</p>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="text-sm space-y-4 mt-2">
          <div>
            <p className="font-semibold">🎬 Work Requests & Assignments</p>
            <p>
              Work requests are now fully synced in real time. If you are assigned to a job,
              or if the time, location, vehicle, or status changes, you will be notified automatically.
            </p>
          </div>

          <div>
            <p className="font-semibold">🔔 Notifications (Important)</p>
            <p>Lo Board can now send you real notifications.</p>
            <ul className="list-disc ml-5 mt-1 space-y-1">
              <li>
                Go to <strong>My Profile</strong>
              </li>
              <li>Enable notifications</li>
              <li>Allow permission when your browser asks</li>
            </ul>
            <p className="mt-2">
              You will receive alerts when you are assigned work, when details change, or when your leave
              is approved or denied.
            </p>
            <p className="mt-1">
              If notifications are not enabled, you may miss important updates.
            </p>
          </div>

          <div>
            <p className="font-semibold">👤 My Profile</p>
            <p>Your profile now includes:</p>
            <ul className="list-disc ml-5 mt-1 space-y-1">
              <li>Leave balances (Annual + Off Days)</li>
              <li>Leave request form</li>
              <li>Notification settings</li>
              <li>Your personal notification inbox</li>
              <li>Suggestion box</li>
            </ul>
          </div>

          <div>
            <p className="font-semibold">📅 Leave Management</p>
            <p>
              You can submit leave requests directly in the system. Admins review and approve requests,
              and balances update automatically.
            </p>
          </div>

          <div>
            <p className="font-semibold">🚗 Fleet & Vehicles</p>
            <p>
              Vehicle assignments are synced. If a vehicle changes on your job, you will be notified.
            </p>
          </div>

          <div>
            <p className="font-semibold">🔊 Optional Sound Alerts</p>
            <p>
              Notification sounds can be enabled or disabled in <strong>My Profile</strong>. Sounds
              respect your browser settings.
            </p>
          </div>

          <div>
            <p className="font-semibold">🧠 What This Means</p>
            <p>
              Lo Board is now a live operational system; the system keeps you informed.
            </p>
          </div>

          <div className="bg-muted/40 p-3 rounded-md text-xs">
            <p className="font-semibold">Before you continue:</p>
            <p>
              Please open <strong>My Profile</strong>, enable notifications, and review your settings
              to ensure you receive future updates.
            </p>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Dismiss</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
