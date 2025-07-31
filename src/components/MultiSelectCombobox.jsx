import { useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Command,
  CommandInput,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function MultiSelectCombobox({
  options = [],
  sections = [],
  selected = [],
  onChange,
  disabled = false,
  placeholder = "Select...",
  label = "",
  searchable = true,
}) {

  const [open, setOpen] = useState(false);

  const toggleValue = (val) => {
  if (typeof onChange !== "function") return;
  if (selected.includes(val)) {
    onChange(selected.filter((v) => v !== val));
  } else {
    onChange([...selected, val]);
  }
};


  // Support {label, value} format
  const resolvedOptions = options.length && typeof options[0] === "object"
    ? options
    : options.map((opt) => ({ label: opt, value: opt }));

  const selectedLabels = resolvedOptions
    .filter((opt) => selected.includes(opt.value))
    .map((opt) => opt.label);

  return (
    <div className="w-full">
      {label && <div className="mb-1 text-sm font-medium">{label}</div>}

      <Popover open={open} onOpenChange={!disabled ? setOpen : () => {}}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={`flex w-full justify-between rounded border p-2 text-sm bg-white ${
              disabled ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            {selectedLabels.length > 0 ? selectedLabels.join(", ") : placeholder}
            <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0 max-h-64 overflow-y-auto">
          <Command>
            {searchable && (
              <CommandInput placeholder="Search..." autoFocus={false} />
            )}
            <CommandEmpty>No results found.</CommandEmpty>
           <CommandGroup>
  {resolvedOptions
    .filter((opt) => opt?.value) // ✅ ensures no undefined keys
    .map((opt) => (
      <CommandItem
        key={opt.value}
        onSelect={() => toggleValue(opt.value)}
        className="flex justify-between"
      >
        {opt.label}
        {selected.includes(opt.value) && (
          <Check className="w-4 h-4 text-primary" />
        )}
      </CommandItem>
    ))}
</CommandGroup>

          </Command>
        </PopoverContent>
      </Popover>

      <div className="mt-2 flex flex-wrap gap-1">
  {resolvedOptions
    .filter((opt) => selected.includes(opt.value))
    .map((opt) => (
      <Badge key={opt.value} variant="secondary">
        {opt.label}
      </Badge>
    ))}
</div>

    </div>
  );
}
