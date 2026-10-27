interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  disabled?: boolean;
  /** Shown on hover, e.g. why an option is disabled. */
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T | null;
  onChange: (id: T) => void;
  label: string;
}

/** Side-by-side choice buttons where one is on, e.g. Light / Dark. */
export function SegmentedControl<T extends string>({ options, value, onChange, label }: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} class="grid auto-cols-fr grid-flow-col gap-2">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.id)}
            class={`h-9 border disabled:opacity-40 disabled:pointer-events-none ${on ? 'border-accent bg-selection text-strong font-semibold' : 'border-border hover:bg-hover'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
