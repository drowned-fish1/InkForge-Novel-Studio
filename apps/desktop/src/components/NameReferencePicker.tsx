import { ReferencePicker } from "@/components/ReferencePicker";
import { referenceValues, resolveReferenceValues, type ReferenceOption } from "@/lib/referenceOptions";

interface NameReferencePickerProps {
  label: string;
  names: string[];
  ids?: string[];
  options: ReferenceOption[];
  onChange: (names: string[], ids: string[]) => void;
  multiple?: boolean;
}

export const NameReferencePicker = ({
  label,
  names,
  ids,
  options,
  onChange,
  multiple = true
}: NameReferencePickerProps) => (
  <ReferencePicker
    label={label}
    options={options}
    multiple={multiple}
    allowCustom
    value={referenceValues(names, ids, options)}
    onChange={(value) => {
      const resolved = resolveReferenceValues(value, options);
      // Unresolved historical IDs are kept until explicitly removed.
      const unresolvedIds = (ids ?? []).filter(
        (id) => value.includes(id) && !options.some((option) => option.value === id)
      );
      onChange(
        resolved.names.filter((name) => !unresolvedIds.includes(name)),
        [...resolved.ids, ...unresolvedIds]
      );
    }}
  />
);
