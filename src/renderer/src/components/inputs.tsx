import type { ComponentChildren, KeyboardEventHandler, Ref } from 'preact';

const FIELD = 'h-7 px-2 bg-editor border border-border text-strong outline-none focus:border-accent placeholder:text-muted';

interface TextInputProps {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  testId?: string;
  class?: string;
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  onFocus?: () => void;
  onBlur?: () => void;
  autoFocus?: boolean;
}

export function TextInput({ value, onInput, placeholder, testId, class: cls = '', inputRef, onKeyDown, onFocus, onBlur, autoFocus }: TextInputProps) {
  return (
    <input
      ref={inputRef}
      class={`${FIELD} select-text ${cls}`}
      value={value}
      placeholder={placeholder}
      data-testid={testId}
      spellcheck={false}
      autoFocus={autoFocus}
      onInput={(e) => onInput(e.currentTarget.value)}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  );
}

interface SelectProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  class?: string;
}

export function Select<T extends string>({ value, options, onChange, class: cls = '' }: SelectProps<T>) {
  return (
    <select class={`${FIELD} ${cls}`} value={value} onChange={(e) => onChange(e.currentTarget.value as T)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  testId?: string;
}

export function Checkbox({ checked, onChange, label, testId }: CheckboxProps) {
  return (
    <label class="inline-flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        class="size-4 accent-accent cursor-pointer"
        checked={checked}
        data-testid={testId}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      {label}
    </label>
  );
}

interface ToggleProps {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
}

export function Toggle({ on, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={() => onChange(!on)}
      class={`relative w-7 h-3.5 shrink-0 ${on ? 'bg-accent' : 'bg-border'}`}
    >
      <span class={`absolute top-0.5 size-2.5 bg-strong ${on ? 'right-0.5' : 'left-0.5'}`} />
    </button>
  );
}

interface FormFieldProps {
  label: string;
  children: ComponentChildren;
}

export function FormField({ label, children }: FormFieldProps) {
  return (
    <label class="grid grid-cols-[140px_1fr] items-center gap-3 mb-2.5">
      <span>{label}</span>
      {children}
    </label>
  );
}
