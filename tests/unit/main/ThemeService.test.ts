import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEME_TOKENS, type ThemeFile } from '@shared/types';
import { ThemeService } from '../../../src/main/Services/ThemeService';

const saturn = JSON.parse(readFileSync('resources/themes/saturn.json', 'utf8')) as ThemeFile;

describe('theme validation', () => {
  it('accepts a theme with an id, a name and one variant', () => {
    expect(ThemeService.validate({ id: 'x', name: 'X', dark: {} })).toBe(true);
  });

  it('rejects unsafe ids and themes without a variant', () => {
    expect(ThemeService.validate({ id: '../../x', name: 'X', dark: {} })).toBe(false);
    expect(ThemeService.validate({ id: 'x', name: 'X' })).toBe(false);
    expect(ThemeService.validate({ id: 'X', name: 'X', dark: {} })).toBe(false);
  });

  it('every built-in theme is complete', () => {
    for (const file of ['saturn', 'high-contrast', 'dyslexia-friendly']) {
      const theme = JSON.parse(readFileSync(`resources/themes/${file}.json`, 'utf8')) as ThemeFile;
      expect(ThemeService.validate(theme)).toBe(true);
      expect(ThemeService.complete(theme, saturn).missing).toEqual([]);
    }
  });
});

describe('completing themes', () => {
  it("fills missing colours and syntax from Saturn's theme and lists them", () => {
    const { theme, missing } = ThemeService.complete({ id: 'x', name: 'X', dark: { colors: { text: 'white' } } as never }, saturn);
    expect(theme.dark!.colors.text).toBe('white');
    expect(theme.dark!.colors.error).toBe(saturn.dark!.colors.error);
    expect(Object.keys(theme.dark!.colors)).toEqual([...THEME_TOKENS]);
    expect(theme.dark!.syntax).toEqual(saturn.dark!.syntax);
    expect(missing).toContain('error colour');
    expect(missing).toContain('syntax colours');
  });

  it('keeps safe fonts and drops unsafe ones', () => {
    const { theme, missing } = ThemeService.complete({ id: 'x', name: 'X', fonts: { ui: 'Inter, sans-serif', editor: 'x; } body { color: red' }, light: saturn.light }, saturn);
    expect(theme.fonts).toEqual({ ui: 'Inter, sans-serif' });
    expect(missing).toEqual(['code font (invalid)']);
  });
});
