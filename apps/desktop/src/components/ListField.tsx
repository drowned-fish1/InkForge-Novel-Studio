import { useEffect, useRef, useState } from "react";

interface ListFieldProps {
  value: string[];
  onChange: (value: string[]) => void;
  multiline?: boolean;
  list?: string;
}

/** Keep separators and IME text intact while the parent receives the parsed list. */
export const ListField = ({ value, onChange, multiline = false, list }: ListFieldProps) => {
  const [text, setText] = useState(() => value.join(multiline ? "\n" : ", "));
  const lastValue = useRef(JSON.stringify(value));
  const composing = useRef(false);
  useEffect(() => {
    const next = JSON.stringify(value);
    if (next !== lastValue.current) {
      lastValue.current = next;
      setText(value.join(multiline ? "\n" : ", "));
    }
  }, [value, multiline]);

  const update = (text: string) => {
    const next = text
      .split(multiline ? /\n/u : /[,，\n]/u)
      .map((item) => item.trim())
      .filter(Boolean);
    lastValue.current = JSON.stringify(next);
    onChange(next);
  };
  const props = {
    value: text,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setText(event.target.value);
      if (!composing.current) update(event.target.value);
    },
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: (event: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      composing.current = false;
      update(event.currentTarget.value);
    }
  };
  return multiline ? <textarea {...props} /> : <input {...props} list={list} />;
};
