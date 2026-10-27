import { IconButton, ModuleIcon, QuestionIcon } from '@renderer/components';
import { useWorkspace } from '@renderer/screens/editor/EditorWorkspace';

/**
 * The editor's right-hand bar, below the top bar's Settings button: one button per `contributes.buttons`
 * entry from languages and extensions. Buttons run their module's command; they don't open panels.
 * Hidden when no module adds a button.
 */
export function ButtonStrip() {
  const ws = useWorkspace();
  const buttons = ws.modules.snapshot.value.buttons;
  if (buttons.length === 0) return null;
  return (
    <div class="w-9 shrink-0 flex flex-col items-center gap-1 py-1 bg-panel border-l border-divider" data-testid="button-strip">
      {buttons.map((b) => (
        <IconButton
          key={`${b.moduleId}:${b.command}`}
          icon={b.iconUrl ? <ModuleIcon icon={b.iconUrl} badge={b.title} /> : <QuestionIcon />}
          label={b.title}
          data-testid={`strip-button-${b.command}`}
          onClick={() => void window.saturn.modules.runCommand(b.command).catch((e) => {
            ws.notice.value = { text: String((e as Error).message).replace(/^.*Error: /, ''), kind: 'error' };
          })}
        />
      ))}
    </div>
  );
}
