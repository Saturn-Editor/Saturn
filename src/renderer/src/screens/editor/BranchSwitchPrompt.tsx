import { useState } from 'preact/hooks';
import { Button, Checkbox } from '@renderer/components';
import { useWorkspace } from './EditorWorkspace';

/**
 * Asked when switching branches with uncommitted changes: bring them to the new branch, or shelve
 * them for the one being left. "Remember my choice" saves it (Settings → Advanced → Git can change it).
 */
export function BranchSwitchPrompt() {
  const ws = useWorkspace();
  const prompt = ws.branchSwitchPrompt.value;
  const [remember, setRemember] = useState(false);
  if (!prompt) return null;

  const choose = (mode: 'bring' | 'shelve' | null) => {
    if (mode && remember) void window.saturn.settings.update({ branchSwitch: mode });
    setRemember(false);
    prompt.resolve(mode);
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="branch-switch-prompt" onKeyDown={(e) => e.key === 'Escape' && choose(null)}>
      <div class="w-[440px] p-4 bg-raised border border-border shadow-lg shadow-black/40 flex flex-col gap-3">
        <div class="font-semibold text-strong">Switch to {prompt.branch}</div>
        <p class="m-0">You have uncommitted changes. What should happen to them?</p>
        <ul class="m-0 pl-4 text-muted">
          <li><span class="text-text">Bring them along:</span> they carry on in {prompt.branch}.</li>
          <li><span class="text-text">Shelve them:</span> they're put aside for this branch and come back when you return.</li>
        </ul>
        <label class="flex items-center gap-2">
          <Checkbox checked={remember} onChange={() => setRemember(!remember)} testId="branch-switch-remember" />
          <span>Remember my choice</span>
        </label>
        <div class="flex justify-end gap-2">
          <Button onClick={() => choose(null)}>Cancel</Button>
          <Button testId="branch-switch-shelve" onClick={() => choose('shelve')}>Shelve them</Button>
          <Button variant="primary" testId="branch-switch-bring" onClick={() => choose('bring')}>Bring them along</Button>
        </div>
      </div>
    </div>
  );
}
