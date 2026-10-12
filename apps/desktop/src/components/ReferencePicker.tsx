import { useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { ReferenceOption } from "@/lib/referenceOptions";

interface ReferencePickerProps {
  label: string;
  options: ReferenceOption[];
  value: string[];
  onChange: (value: string[]) => void;
  multiple?: boolean;
  allowCustom?: boolean;
}

export const ReferencePicker = ({
  label,
  options,
  value,
  onChange,
  multiple = false,
  allowCustom = false
}: ReferencePickerProps) => {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [announcement, setAnnouncement] = useState("");
  const [placement, setPlacement] = useState({ above: false, height: 230 });
  const keyword = query.trim().toLocaleLowerCase("zh-CN");
  const filtered = options.filter(
    (option) =>
      !value.includes(option.value) &&
      (!keyword ||
        [option.label, option.description ?? "", ...(option.keywords ?? [])]
          .join(" ")
          .toLocaleLowerCase("zh-CN")
          .includes(keyword))
  );
  const canCreate =
    allowCustom &&
    Boolean(keyword) &&
    !value.includes(query.trim()) &&
    !options.some((option) =>
      [option.label, ...(option.keywords ?? [])].some((name) => name.toLocaleLowerCase("zh-CN") === keyword)
    );
  const choices = canCreate
    ? [...filtered, { value: query.trim(), label: query.trim(), description: "使用自定义名称" }]
    : filtered;
  const visibleChoices = choices.slice(0, 40);
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const picker = pickerRef.current;
      if (!picker) return;
      const rect = picker.getBoundingClientRect();
      const container = picker.closest(".library-editor")?.getBoundingClientRect();
      const below = Math.min(window.innerHeight, container?.bottom ?? window.innerHeight) - rect.bottom - 8;
      const above = rect.top - Math.max(0, container?.top ?? 0) - 8;
      const flip = below < 140 && above > below;
      const height = Math.max(60, Math.min(230, flip ? above : below));
      setPlacement((previous) =>
        previous.above === flip && previous.height === height ? previous : { above: flip, height }
      );
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, choices.length]);
  const choose = (option: ReferenceOption) => {
    onChange(multiple ? [...new Set([...value, option.value])] : [option.value]);
    setQuery("");
    setActive(-1);
    setOpen(multiple);
    setAnnouncement(`已选择 ${option.label}`);
    inputRef.current?.focus();
  };

  return (
    <div className="reference-field">
      <span className="reference-field-label" id={`${listId}-label`}>
        {label}
      </span>
      <div
        className="reference-picker"
        ref={pickerRef}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setOpen(false);
            setQuery("");
            setActive(-1);
          }
        }}
      >
        <div className="reference-picker-control">
          {value.map((item) => (
            <span className="reference-chip" key={item}>
              <span>{options.find((option) => option.value === item)?.label ?? item}</span>
              <button
                type="button"
                aria-label={`移除${label}：${options.find((option) => option.value === item)?.label ?? item}`}
                onClick={() => {
                  onChange(value.filter((entry) => entry !== item));
                  setAnnouncement("已移除选择");
                }}
              >
                <X size={13} />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            role="combobox"
            aria-labelledby={`${listId}-label`}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && active >= 0 && visibleChoices[active] ? `${listId}-${active}` : undefined}
            placeholder={`搜索${label}${allowCustom ? "或输入新名称" : ""}`}
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setActive(-1);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape" && open) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                setQuery("");
                setActive(-1);
              } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
                const next =
                  event.key === "ArrowDown" ? Math.min(active + 1, visibleChoices.length - 1) : Math.max(active - 1, 0);
                setActive(next);
                document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" });
              } else if (event.key === "Enter" && open) {
                event.preventDefault();
                const option = visibleChoices[active] ?? (visibleChoices.length === 1 ? visibleChoices[0] : undefined);
                if (option) choose(option);
              }
            }}
          />
          <button
            className="reference-picker-toggle"
            type="button"
            aria-label={`展开${label}选项`}
            onClick={() => {
              setOpen(!open);
              if (!open) inputRef.current?.focus();
            }}
          >
            <ChevronDown size={15} />
          </button>
        </div>
        {open ? (
          <div
            className="reference-picker-options"
            data-side={placement.above ? "above" : "below"}
            style={{ maxHeight: placement.height }}
            role="listbox"
            aria-multiselectable={multiple || undefined}
            aria-labelledby={`${listId}-label`}
            id={listId}
          >
            {visibleChoices.map((option, index) => (
              <button
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={active === index}
                id={`${listId}-${index}`}
                key={option.value}
                className={active === index ? "active" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
              >
                <strong>{option.label}</strong>
                {option.description ? <small>{option.description}</small> : null}
              </button>
            ))}
            {!visibleChoices.length ? <p>{options.length ? "没有匹配的可选条目" : "还没有可选条目"}</p> : null}
            {choices.length > 40 ? <p>还有 {choices.length - 40} 条，请输入名称缩小范围。</p> : null}
          </div>
        ) : null}
      </div>
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </div>
  );
};
