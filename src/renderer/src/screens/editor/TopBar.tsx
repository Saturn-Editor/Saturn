import { useEffect, useState } from 'preact/hooks';
import { Badge, GearIcon, IconButton } from '@renderer/components';
import { ActionSearch } from '@renderer/commands/ActionSearch';
import { RunMenu } from '@renderer/run/RunMenu';
import { useWorkspace } from './EditorWorkspace';

export function TopBar() {
  const ws = useWorkspace();
  const [languageId, setLanguageId] = useState<string | null>(null);

  useEffect(() => {
    void window.saturn.projects.recent().then((list) => setLanguageId(list.find((p) => p.path === ws.projectPath)?.languageId ?? null));
  }, []);
  const badge = ws.modules.snapshot.value.languages.find((l) => l.id === languageId)?.badge ?? 'T';

  return (
    <header class="flex items-center gap-3.5 h-10 px-2.5 bg-panel border-b border-divider shrink-0">
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <Badge text={badge} />
        <span class="font-semibold text-strong truncate" data-testid="project-name">{ws.projectName}</span>
        {/* Plan 2 adds the current git branch here. */}
      </div>
      <ActionSearch />
      <div class="flex items-center gap-2 flex-1 justify-end">
        <RunMenu />
        <IconButton icon={<GearIcon />} label="Settings" onClick={() => window.saturn.windows.openSettings()} />
      </div>
    </header>
  );
}
