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
          <AlertDialogTitle>📦 What’s New in Version 0.7.1</AlertDialogTitle>
          <AlertDialogDescription>
            Leave management is now available in the system.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="text-sm space-y-3">
          <p>
            You can now apply for leave directly from <strong>My Profile</strong>.
            Choose the type of leave, number of days, and submit your request in a few clicks.
          </p>

          <p>
            Admins can review leave requests in their settings and either approve or deny them.
            Once a decision is made, leave balances are updated automatically.
          </p>

          <p>
            This makes requesting and managing leave clearer, faster, and more transparent for everyone.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Dismiss</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
