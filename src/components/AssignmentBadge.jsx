export default function AssignmentBadge({ status }) {
  let color = "bg-gray-200 text-gray-800";
  let label = status || "Unassigned";

  if (status === "Partially Assigned") {
    color = "bg-yellow-200 text-yellow-800";
  }
  if (status === "Fully Assigned") {
    color = "bg-green-200 text-green-800";
  }

  return (
    <span
      className={`inline-block px-2 py-1 text-xs font-semibold rounded ${color}`}
    >
      {label}
    </span>
  );
}
