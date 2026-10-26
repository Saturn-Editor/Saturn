import type { ButtonHTMLAttributes, ComponentChild } from 'preact';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'icon' | 'label' | 'class'> {
  icon: ComponentChild;
  label: string;
  active?: boolean;
  disabled?: boolean;
  class?: string;
}

export function IconButton({ icon, label, active, disabled, class: cls = '', ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      class={`size-7 inline-flex items-center justify-center shrink-0 disabled:opacity-40 disabled:pointer-events-none ${
        active ? 'bg-selection text-strong' : 'text-muted hover:bg-hover hover:text-strong'
      } ${cls}`}
      {...rest}
    >
      {icon}
    </button>
  );
}
