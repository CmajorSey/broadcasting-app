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
          <AlertDialogTitle>📦 What’s New in Version 0.6.3</AlertDialogTitle>
          <AlertDialogDescription>
            A quick look at the latest improvements.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-64 overflow-y-auto text-sm space-y-2">
          <ul className="list-disc ml-4 space-y-1">
            <li>🔑 You can now reset your password with an admin request – A temporary password will be sent for reset.</li>
            <li>🛡️ All new passwords are stored more securely in the system.</li>
            <li>✅ Login is smoother and works for both older and updated accounts.</li>
            <li>🚦 Error messages are clearer, and you’ll see a toast when login works or fails.</li>
            <li>🌐 Connections between the app and server are more reliable, whether you’re on LAN, local, or online.</li>
          </ul>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Dismiss</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
