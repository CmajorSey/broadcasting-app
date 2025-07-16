import { useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Command,
  CommandInput,
  CommandEmpty,
  CommandItem,
} from "@/components/ui/command";

export default function MultiSelectCombobox({ options = [], sections = [], selected, onChange }) {
  const [open, setOpen] = useState(false);

  const toggleSelection = (value) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  // If options are provided, use flat mode
  const isFlat = options && options.length > 0;

  return (
    <Popover
  open={open}
  onOpenChange={(nextOpen) => {
    setOpen(nextOpen);
    // Blur the input after opening to show options immediately
    setTimeout(() => {
      const active = document.activeElement;
      if (nextOpen && active?.tagName === "INPUT") {
        active.blur();
      }
    }, 10);
  }}
>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full justify-between rounded border p-2 text-sm"
        >
          {selected.length > 0 ? selected.join(", ") : "Select users..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0 max-h-64 overflow-y-auto">
        <Command>
         <CommandInput placeholder="Search users..." autoFocus={false} />
          <CommandEmpty>No users found.</CommandEmpty>
          {isFlat ? (
            options.map((option) => (
              <CommandItem
                key={option}
                onSelect={() => toggleSelection(option)}
              >
                <Check
                  className={`mr-2 h-4 w-4 ${
                    selected.includes(option) ? "opacity-100" : "opacity-0"
                  }`}
                />
                {option}
              </CommandItem>
            ))
          ) : (
            sections.map((section, i) => (
              <div key={section.label}>
                {i > 0 && (
                  <div
                    className="my-1 border-t border-gray-300 opacity-50"
                    aria-hidden="true"
                  />
                )}
                {section.options.map((option) => (
                  <CommandItem
                    key={option}
                    onSelect={() => toggleSelection(option)}
                  >
                    <Check
                      className={`mr-2 h-4 w-4 ${
                        selected.includes(option) ? "opacity-100" : "opacity-0"
                      }`}
                    />
                    {option}
                  </CommandItem>
                ))}
              </div>
            ))
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
