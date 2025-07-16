// src/components/DutyBadge.jsx
export default function DutyBadge({ label, color = "gray" }) {
  const bg = {
    red: "bg-red-100 text-red-700",
    yellow: "bg-yellow-100 text-yellow-800",
    blue: "bg-blue-100 text-blue-800",
    gray: "bg-gray-100 text-gray-700"
  }[color] || "bg-gray-100 text-gray-700";

  return (
    <span className={`ml-1 px-2 py-0.5 rounded text-xs font-medium ${bg}`}>
      {label}
    </span>
  );
}
