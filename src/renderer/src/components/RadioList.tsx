interface RadioListItem<T extends string> {
  id: T;
  label: string;
  /** Muted text on the right, e.g. "Built in". */
  detail?: string;
}

interface RadioListProps<T extends string> {
  items: RadioListItem<T>[];
  value: T | null;
  onChange: (id: T) => void;
  label: string;
}

/** A full-width list where one row is selected, e.g. picking the theme in Settings. */
export function RadioList<T extends string>({ items, value, onChange, label }: RadioListProps<T>) {
  return (
    <div role="radiogroup" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={item.id === value}
          onClick={() => onChange(item.id)}
          class={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left ${item.id === value ? 'bg-selection text-strong' : 'hover:bg-hover'}`}
        >
          <span class="flex-1">{item.label}</span>
          {item.detail && <span class="text-muted">{item.detail}</span>}
        </button>
      ))}
    </div>
  );
}
