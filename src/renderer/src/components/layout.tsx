import type { ComponentChildren } from 'preact';

/** A bold, normal-case section heading with a divider (never all-caps). */
export function Heading({ children, class: cls = '' }: { children: ComponentChildren; class?: string }) {
  return <h3 class={`m-0 mb-2 pb-1 font-semibold text-strong text-xs border-b border-divider ${cls}`}>{children}</h3>;
}

/** Right-aligned row of dialog buttons. */
export function DialogFooter({ children }: { children: ComponentChildren }) {
  return <div class="flex justify-end gap-2 px-4 py-2 bg-panel border-t border-divider">{children}</div>;
}

/** Small square tag, e.g. a language or source marker. */
export function Badge({ text, class: cls = '' }: { text: string; class?: string }) {
  return (
    <span class={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-0.5 bg-divider text-strong text-[9px] font-semibold shrink-0 ${cls}`}>
      {text}
    </span>
  );
}

/** A project's language badges side by side, e.g. PHP + JS. */
export function LanguageBadges({ badges }: { badges: string[] }) {
  return (
    <span class="inline-flex gap-0.5 shrink-0" data-testid="language-badges">
      {badges.map((b) => <Badge key={b} text={b} />)}
    </span>
  );
}

/** Window title strip used by dialog-style windows. */
export function TitleBar({ children }: { children: ComponentChildren }) {
  return <div class="px-3 py-1.5 bg-panel border-b border-divider font-semibold text-strong">{children}</div>;
}
