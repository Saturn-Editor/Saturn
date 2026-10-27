import { signal } from '@preact/signals';
import { formatBinding, KEYMAP_ACTIONS, matchesBinding, resolveBinding, type CustomKeymap, type KeymapChoice } from '@shared/keymaps';

export const isMac = navigator.userAgent.includes('Mac');

/** The keymap chosen in Settings (built-in or custom), and the user's custom keymaps, kept in sync across windows. */
export const keymapId = signal<KeymapChoice>('os');
export const customKeymaps = signal<CustomKeymap[]>([]);

/** Loads the keymap settings and follows changes to them. Call once per window before rendering. */
export async function followKeymap(): Promise<void> {
  const apply = (s: { keymap: KeymapChoice; customKeymaps: CustomKeymap[] }) => {
    keymapId.value = s.keymap;
    customKeymaps.value = s.customKeymaps;
  };
  apply(await window.saturn.settings.get());
  window.saturn.settings.onChanged(apply);
}

/** An action's key in the current keymap, or null. */
function currentBinding(actionId: string): string | null {
  return resolveBinding(actionId, keymapId.value, customKeymaps.value, isMac);
}

/** An action's shortcut in the current keymap as people read it ("⌘⇧A"), or null if it has none. */
export function shortcutFor(actionId: string): string | null {
  const binding = currentBinding(actionId);
  return binding ? formatBinding(binding, isMac) : null;
}

/** The action (of the given scope) whose shortcut in the current keymap matches this key press. */
export function actionForKey(e: KeyboardEvent, scope: 'app' | 'editor'): string | null {
  for (const action of KEYMAP_ACTIONS) {
    if (action.scope !== scope) continue;
    const binding = currentBinding(action.id);
    if (binding && matchesBinding(e, binding, isMac)) return action.id;
  }
  return null;
}
