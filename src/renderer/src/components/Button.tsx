import type { ComponentChildren } from 'preact';

interface ButtonProps {
  variant?: 'primary' | 'secondary';
  onClick?: () => void;
  children: ComponentChildren;
  disabled?: boolean;
  title?: string;
  testId?: string;
  class?: string;
}

export function Button({ variant = 'secondary', onClick, children, disabled, title, testId, class: cls = '' }: ButtonProps) {
  const look = variant === 'primary'
    ? 'bg-accent text-on-accent font-semibold border border-accent hover:brightness-110'
    : 'border border-border text-strong hover:bg-hover';
  return (
    <button
      type="button"
      class={`h-7 px-3 inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none ${look} ${cls}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testId}
    >
      {children}
    </button>
  );
}
