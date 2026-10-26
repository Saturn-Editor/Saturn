import { useEffect, useState } from 'preact/hooks';
import { GearIcon, IconButton, LanguageBadges } from '@renderer/components';
import { ActionSearch } from '@renderer/commands/ActionSearch';
import { projectBadges } from '@renderer/modules/ModuleBridge';
import { RunMenu } from '@renderer/run/RunMenu';
import { useWorkspace } from './EditorWorkspace';

export function TopBar() {
  const ws = useWorkspace();
  const [languageIds, setLanguageIds] = useState<string[]>([]);

  useEffect(() => {
    void window.saturn.projects.recent().then((list) => setLanguageIds(list.find((p) => p.path === ws.projectPath)?.languageIds ?? []));
  }, []);
  const badges = projectBadges(ws.modules.snapshot.value, languageIds);

  return (
    <header class="flex items-center gap-3.5 h-10 px-2.5 bg-panel border-b border-divider shrink-0">
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <LanguageBadges badges={badges} />
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
