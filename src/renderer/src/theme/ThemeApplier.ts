import { THEME_TOKENS, type Theme } from '@shared/types';

const TAILWIND_COLOR = /^([a-z]+(?:-\d{2,3})?)(?:\/(\d{1,3}))?$/;

/**
 * Turns a theme colour into CSS. Theme files use Tailwind colour names, optionally with an
 * opacity ("neutral-900", "amber-500/18", "white/5"); anything else is passed through as plain CSS.
 * Syntax rules can also name one of the theme's own tokens ("text", "muted"), e.g. so code embedded in
 * a string goes back to the normal text colour.
 */
export function resolveColor(value: string): string {
  if ((THEME_TOKENS as readonly string[]).includes(value.trim())) return `var(--saturn-${value.trim()})`;
  const match = TAILWIND_COLOR.exec(value.trim());
  if (!match) return value;
  const [, name, opacity] = match;
  const color = `var(--color-${name})`;
  return opacity ? `color-mix(in oklab, ${color} ${opacity}%, transparent)` : color;
}

/**
 * The concrete colour of a theme token, as rgba() (for libraries such as xterm that can't read
 * CSS variables). The browser resolves the variable, then a 1px canvas converts it to rgba.
 */
export function tokenRgba(token: string): string {
  const probe = document.createElement('div');
  probe.style.color = `var(--saturn-${token})`;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.fillStyle = resolved;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

export function themeVariables(): string {
  return THEME_TOKENS.map((t) => `--saturn-${t}: ${tokenRgba(t)};`).join(' ');
}

let current: Theme | null = null;

/** The theme applied to this window (null before the first apply). */
export function activeTheme(): Theme | null {
  return current;
}

/** Applies a theme by writing its colours to CSS variables that the Tailwind tokens point at. */
export class ThemeApplier {
  apply(theme: Theme, root: HTMLElement = document.documentElement): void {
    current = theme;
    for (const [token, value] of Object.entries(theme.colors)) {
      root.style.setProperty(`--saturn-${token}`, resolveColor(value));
    }
    for (const [name, value] of [['ui', theme.fonts.ui], ['editor', theme.fonts.editor]] as const) {
      if (value) root.style.setProperty(`--saturn-font-${name}`, value);
      else root.style.removeProperty(`--saturn-font-${name}`);
    }
    root.dataset.themeType = theme.type;
    root.dataset.themeId = theme.id;
    window.dispatchEvent(new CustomEvent('saturn:theme', { detail: theme }));
  }

  /** Applies the active theme now and keeps following theme changes. */
  async follow(): Promise<void> {
    this.apply(await window.saturn.themes.active());
    window.saturn.themes.onChanged((t) => this.apply(t));
  }
}
