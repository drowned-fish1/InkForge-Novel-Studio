export interface ReferenceOption {
  value: string;
  label: string;
  description?: string;
  keywords?: string[];
}

// Keep legacy names and unresolved IDs visible while editing stable references.
export const referenceValues = (names: string[], ids: string[] = [], options: ReferenceOption[]): string[] => {
  const remaining = new Set(ids);
  const values = names.map((name) => {
    const matches = options.filter((option) => [option.label, ...(option.keywords ?? [])].includes(name));
    const option = matches.find((item) => remaining.has(item.value)) ?? (matches.length === 1 ? matches[0] : undefined);
    if (!option) return name;
    remaining.delete(option.value);
    return option.value;
  });
  return [...new Set([...values, ...remaining])];
};

export const resolveReferenceValues = (values: string[], options: ReferenceOption[]) => ({
  names: values.map((value) => options.find((option) => option.value === value)?.label ?? value),
  ids: values.filter((value) => options.some((option) => option.value === value))
});
