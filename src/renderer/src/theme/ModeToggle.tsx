import { useEffect, useState } from 'preact/hooks';
import { THEME_MODES, type Theme, type ThemeMode, type ThemeSummary } from '@shared/types';
import { Checkbox, SegmentedControl } from '@renderer/components';

export const MODE_LABELS: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark' };

/**
 * Light / Dark switch; picks which variant of the active theme is shown. Shows the variant in use,
 * and greys out a mode the active theme doesn't have.
 */
export function ModeToggle() {
  const [active, setActive] = useState<Theme | null>(null);
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [sync, setSync] = useState(false);
  useEffect(() => {
    const loadList = () => void window.saturn.themes.list().then(setThemes);
    const loadSync = () => void window.saturn.themes.syncWithOs().then(setSync);
    void window.saturn.themes.active().then(setActive);
    loadList();
    loadSync();
    const offActive = window.saturn.themes.onChanged((t) => {
      setActive(t);
      loadSync();
    });
    const offList = window.saturn.themes.onListChanged(loadList);
    return () => {
      offActive();
      offList();
    };
  }, []);
  const available = themes.find((t) => t.id === active?.id)?.modes ?? THEME_MODES;

  return (
    <div class="flex flex-col gap-2">
      <SegmentedControl
        label="Mode"
        value={active?.type ?? null}
        onChange={(mode) => void window.saturn.themes.setMode(mode)}
        options={THEME_MODES.map((mode) => {
          const missing = !available.includes(mode);
          return {
            id: mode,
            label: MODE_LABELS[mode],
            disabled: missing,
            title: missing && active ? `${active.name} has no ${MODE_LABELS[mode].toLowerCase()} version` : undefined,
          };
        })}
      />
      {/* Picking Light or Dark above turns this off again. */}
      <Checkbox checked={sync} label="Sync with OS" testId="sync-with-os" onChange={(on) => void window.saturn.themes.setSyncWithOs(on)} />
    </div>
  );
}
