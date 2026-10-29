import { PAGE_FONTS, type PageStyle } from '@shared/notebooks';
import { SegmentedControl } from '@renderer/components';

const BACKGROUNDS = ['#ffffff', '#faf4e4', '#f1f5f9', '#1e1e1e', '#000000'];
const TEXTS = ['#111827', '#1e2a36', '#374151', '#e5e7eb', '#ffffff'];

function ColourRow({ label, value, swatches, defaultLabel, onChange }: { label: string; value: string | null; swatches: string[]; defaultLabel: string; onChange: (c: string | null) => void }) {
  const ring = (on: boolean) => (on ? 'outline outline-2 outline-offset-1 outline-accent' : 'border border-border');
  return (
    <div class="flex items-center gap-2" role="radiogroup" aria-label={label}>
      <span class="w-24 shrink-0">{label}</span>
      <button type="button" role="radio" aria-checked={value === null} title="The theme's colour" onClick={() => onChange(null)} class={`h-7 px-2 ${ring(value === null)}`}>{defaultLabel}</button>
      {swatches.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} title={c} onClick={() => onChange(c)} class={`size-7 ${ring(value === c)}`} style={{ backgroundColor: c }} />
      ))}
      <label class={`relative size-7 cursor-pointer ${ring(!!value && !swatches.includes(value))}`} title="Custom colour" style={{ background: value && !swatches.includes(value) ? value : 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}>
        <input type="color" class="absolute inset-0 opacity-0 cursor-pointer" value={value ?? '#888888'} aria-label={`Custom ${label.toLowerCase()}`} onInput={(e) => onChange(e.currentTarget.value)} />
      </label>
    </div>
  );
}

export function StyleEditor({ value, defaultLabel = 'Default', onChange }: { value: PageStyle; defaultLabel?: string; onChange: (style: PageStyle) => void }) {
  const fonts = PAGE_FONTS.map((f) => (f.id === 'theme' ? { ...f, label: defaultLabel } : f));
  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <span class="w-24 shrink-0">Font</span>
        <div class="flex-1"><SegmentedControl label="Font" value={value.font} onChange={(font) => onChange({ ...value, font })} options={fonts} /></div>
      </div>
      <ColourRow label="Background" value={value.background} swatches={BACKGROUNDS} defaultLabel={defaultLabel} onChange={(background) => onChange({ ...value, background })} />
      <ColourRow label="Text" value={value.text} swatches={TEXTS} defaultLabel={defaultLabel} onChange={(text) => onChange({ ...value, text })} />
    </div>
  );
}

export function styleVariables(style: PageStyle): Record<string, string> {
  const vars: Record<string, string> = {};
  if (style.background) vars['--saturn-editor'] = style.background;
  if (style.text) {
    vars['--saturn-text'] = style.text;
    vars['--saturn-strong'] = style.text;
    vars['--saturn-muted'] = `color-mix(in oklab, ${style.text} 60%, transparent)`;
  }
  return vars;
}

export const FONT_CLASS: Record<PageStyle['font'], string> = { theme: 'font-ui', sans: 'font-sans', serif: 'font-serif', mono: 'font-mono', dyslexic: 'font-dyslexic' };
