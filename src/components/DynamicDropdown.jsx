import { useState } from "react";

function DynamicDropdown({
  label,
  selected,
  items = [],
  onSelect,
  onDelete,
  onAdd,
  placeholder = "Select..."
}) {
  const [dropdownVisible, setDropdownVisible] = useState(false);

  const handleAdd = () => {
    if (!onAdd) return; // If no onAdd prop, do nothing
    const newItem = prompt(`Enter new ${label?.toLowerCase() || "item"}:`);
    if (newItem && !items.includes(newItem)) {
      onAdd.addItem(newItem);
      onSelect(newItem);
      onAdd.setDropdownVisible(false);
    }
  };

  return (
    <div className="space-y-1 relative z-10">
      {label && (
        <label className="block font-semibold mb-1">{label}</label>
      )}
      <div className="relative inline-block w-full">
        <div
          className="input cursor-pointer"
          onClick={() =>
            onAdd
              ? onAdd.toggleDropdown()
              : setDropdownVisible(!dropdownVisible)
          }
        >
          {selected || placeholder}
        </div>

        {(onAdd ? onAdd.dropdownVisible : dropdownVisible) && (
          <div className="absolute mt-1 w-full bg-white border rounded shadow-md max-h-60 overflow-y-auto z-10">
            {items.map((item) => (
              <div
                key={item}
                className="flex justify-between items-center px-4 py-2 hover:bg-gray-100 cursor-pointer group"
                onClick={() => {
                  onSelect(item);
                  if (onAdd) {
                    onAdd.setDropdownVisible(false);
                  } else {
                    setDropdownVisible(false);
                  }
                }}
              >
                <span>{item}</span>
                {onDelete && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(item);
                    }}
                    className="text-red-500 text-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  >
                    ❌
                  </button>
                )}
              </div>
            ))}
            {onAdd && (
              <div
                className="px-4 py-2 text-blue-600 hover:bg-blue-50 cursor-pointer font-medium"
                onClick={handleAdd}
              >
                ➕ Add new {label?.toLowerCase()}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default DynamicDropdown;
