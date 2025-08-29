import { useMemo, useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Command,
  CommandInput,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";

/**
 * MultiSelectCombobox (robust)
 *
 * Accepts options as:
 *   - string[]                       -> values are the strings
 *   - { label: string, value: any }[] -> values normalized to String(value)
 *
 * Selection API (either prop works):
 *   - onChange(next: string[])
 *   - setSelected(next: string[])   // alias for backward compatibility
 *
 * Other props:
 *   - selected: string[] | any[]  (normalized to string[])
 *   - placeholder, label, disabled, searchable
 *   - sections (unused, kept for backward compatibility)
 */
export default function MultiSelectCombobox({
  options = [],
  sections = [],
  selected = [],
  onChange,
  setSelected,            // 👈 accept the old prop name too
  disabled = false,
  placeholder = "Select...",
  label = "",
  searchable = true,
}) {
  const [open, setOpen] = useState(false);

  // Emit helper — prefer onChange, fall back to setSelected, otherwise no-op
  const emit = useMemo(() => {
    if (typeof onChange === "function") return onChange;
    if (typeof setSelected === "function") return setSelected;
    return () => {};
  }, [onChange, setSelected]);

  // Normalize options to [{label, value:String}]
  const normOptions = useMemo(() => {
    if (!Array.isArray(options)) return [];
    return options.map((opt) => {
      if (typeof opt === "string") {
        const v = String(opt);
        return { label: v, value: v };
      }
      const label = String(opt?.label ?? opt?.value ?? "");
      const value = String(opt?.value ?? opt?.label ?? "");
      return { label, value };
    });
  }, [options]);

  // Normalize selected values to strings
  const normSelected = useMemo(
    () => (Array.isArray(selected) ? selected.map((v) => String(v)) : []),
    [selected]
  );

  const selectedLabels = useMemo(() => {
    const map = new Map(normOptions.map((o) => [o.value, o.label]));
    return normSelected.map((v) => map.get(v) ?? v);
  }, [normOptions, normSelected]);

  const toggleValue = (rawVal) => {
    if (disabled) return;
    const val = String(rawVal);
    const set = new Set(normSelected);
    set.has(val) ? set.delete(val) : set.add(val);
    emit(Array.from(set));
  };

  const isSelected = (val) => normSelected.includes(String(val));

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
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            {selectedLabels.length > 0 ? selectedLabels.join(", ") : placeholder}
            <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
          </button>
        </PopoverTrigger>

        <PopoverContent className="w-full p-0 max-h-64 overflow-y-auto">
          <Command>
            {searchable && <CommandInput placeholder="Search..." autoFocus={false} />}
            <CommandEmpty>No results found.</CommandEmpty>

            <CommandGroup>
              {normOptions
                .filter((opt) => opt?.value)
                .map((opt) => (
                  <CommandItem
                    key={opt.value}
                    onSelect={() => toggleValue(opt.value)}
                    className="flex justify-between"
                    role="option"
                    aria-selected={isSelected(opt.value)}
                  >
                    {opt.label}
                    {isSelected(opt.value) && <Check className="w-4 h-4 text-primary" />}
                  </CommandItem>
                ))}
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>

      <div className="mt-2 flex flex-wrap gap-1">
        {normOptions
          .filter((opt) => normSelected.includes(opt.value))
          .map((opt) => (
            <Badge key={opt.value} variant="secondary">
              {opt.label}
            </Badge>
          ))}
      </div>
    </div>
  );
}
