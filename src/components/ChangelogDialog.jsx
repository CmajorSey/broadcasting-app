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
          <AlertDialogTitle>📦 What’s New in Version 0.6.5</AlertDialogTitle>
          <AlertDialogDescription>
            A quick look at the latest improvements for you.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-64 overflow-y-auto text-sm space-y-2">
          <ul className="list-disc ml-4 space-y-1">
            <li>🔔 Notifications are easier to manage – admins can now send, edit, and clear them.</li>
            <li>💡 A new Suggestion Box lets you share your ideas directly from your profile page.</li>
            <li>🧾 Your profile now shows your leave and off-day balances.</li>
            <li>🕒 The clock in the top bar now shows seconds, with a 12h / 24h option that remembers your choice.</li>
            <li>📩 Messages when you log in or reset your password are now clearer and easier to understand.</li>
            <li>📥 Notifications now appear in your profile, with the option to dismiss them one by one or all at once.</li>
          </ul>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Dismiss</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
