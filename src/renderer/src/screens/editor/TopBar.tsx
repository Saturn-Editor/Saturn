import { DebugIcon, GearIcon, IconButton } from '@renderer/components';
import { ActionSearch } from '@renderer/commands/ActionSearch';
import { RunMenu } from '@renderer/screens/editor/RunMenu';
import { BranchMenu } from './BranchMenu';
import { NotificationsMenu } from './NotificationsMenu';
import { ProjectMenu } from './ProjectMenu';
import { useWorkspace } from './EditorWorkspace';

export function TopBar() {
  const ws = useWorkspace();

  return (
    <header class="flex items-center gap-3.5 h-10 px-2.5 bg-panel border-b border-divider shrink-0">
      <div class="flex items-center gap-2 min-w-max flex-1">
        <ProjectMenu />
        <BranchMenu />
      </div>
      <ActionSearch />
      <div class="flex items-center gap-2 min-w-max flex-1 justify-end">
        {!ws.isNotebook && (
          <>
            {ws.keeps('run') && <RunMenu />}
            {ws.keeps('debug') && (
              <IconButton
                icon={<DebugIcon />}
                label={ws.debug.state.value.state === 'stopped' ? 'Continue' : 'Debug the open file'}
                active={ws.debug.state.value.state !== 'idle'}
                data-testid="debug-button"
                onClick={() => void ws.startDebugging()}
              />
            )}
          </>
        )}
        <NotificationsMenu />
        <IconButton icon={<GearIcon />} label="Settings" onClick={() => window.saturn.windows.openSettings(ws.isNotebook ? 'notebooks' : undefined)} />
      </div>
    </header>
  );
}
