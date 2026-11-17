import { useEffect, useState } from 'react';

interface Props {
  id?: string;
  value: number;
  onChange(v: number): void;
  step?: number;
  min?: number;
  className?: string;
  ariaLabel?: string;
  placeholder?: string;
}

/**
 * Number input that keeps the typed text while editing (so clearing the field
 * to retype doesn't snap to 0) and only reports valid numbers.
 */
export function NumberField({ id, value, onChange, step = 1, min, className = 'inp', ariaLabel, placeholder }: Props) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  return (
    <input
      id={id}
      className={className}
      type="number"
      inputMode="decimal"
      step={step}
      min={min}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); setText(String(value)); }}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v) && (min === undefined || v >= min)) onChange(v);
      }}
    />
  );
}
