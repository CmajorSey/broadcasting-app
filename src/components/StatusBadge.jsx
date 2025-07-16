export default function StatusBadge({ status }) {
  const baseClass = "px-2 py-0.5 rounded-full text-xs font-semibold inline-block";

  const statusStyles = {
    Pending: "bg-yellow-100 text-yellow-800",
    Assigned: "bg-blue-100 text-blue-800",
    Dispatched: "bg-orange-100 text-orange-800",
    "In Progress": "bg-purple-100 text-purple-800",
    Completed: "bg-green-100 text-green-800",
    Postponed: "bg-orange-100 text-orange-800",
    Canceled: "bg-red-100 text-red-800",
    Cancelled: "bg-red-100 text-red-800",
  };

  const style = statusStyles[status] || "bg-gray-100 text-gray-800";

  return <span className={`${baseClass} ${style}`}>{status}</span>;
}
