import { useEffect, useState } from 'preact/hooks';
import { GearIcon, IconButton, LanguageBadges } from '@renderer/components';
import { ActionSearch } from '@renderer/commands/ActionSearch';
import { projectBadges } from '@renderer/modules/ModuleBridge';
import { RunMenu } from '@renderer/screens/editor/RunMenu';
import { BranchMenu } from './BranchMenu';
import { NotificationsMenu } from './NotificationsMenu';
import { ProjectMenu } from './ProjectMenu';
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
        <ProjectMenu />
        <BranchMenu />
      </div>
      <ActionSearch />
      <div class="flex items-center gap-2 flex-1 justify-end">
        <RunMenu />
        <NotificationsMenu />
        <IconButton icon={<GearIcon />} label="Settings" onClick={() => window.saturn.windows.openSettings()} />
      </div>
    </header>
  );
}
