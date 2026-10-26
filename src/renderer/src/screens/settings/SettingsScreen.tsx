import { useEffect, useState } from 'preact/hooks';
import type { ThemeSummary } from '@shared/types';
import { Heading, SidebarNav, TitleBar } from '@renderer/components';

type Section = 'appearance';

function AppearanceSection() {
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    void window.saturn.themes.list().then(setThemes);
    void window.saturn.themes.active().then((t) => setActiveId(t.id));
    return window.saturn.themes.onChanged((t) => setActiveId(t.id));
  }, []);

  return (
    <section>
      <Heading>Theme</Heading>
      <div role="radiogroup" aria-label="Theme">
        {themes.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={t.id === activeId}
            onClick={() => void window.saturn.themes.setActive(t.id)}
            class={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left ${t.id === activeId ? 'bg-selection text-strong' : 'hover:bg-hover'}`}
          >
            <span class="flex-1">{t.name}</span>
            <span class="text-muted">{t.builtIn ? 'Built in' : 'Installed'}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function SettingsScreen() {
  const [section, setSection] = useState<Section>('appearance');
  return (
    <div class="flex flex-col h-full" data-testid="screen-settings">
      <TitleBar>Settings</TitleBar>
      <div class="flex flex-1 min-h-0">
        <SidebarNav<Section> items={[{ id: 'appearance', label: 'Appearance' }]} selected={section} onSelect={setSection} />
        <main class="flex-1 p-4 overflow-y-auto">{section === 'appearance' && <AppearanceSection />}</main>
      </div>
    </div>
  );
}
