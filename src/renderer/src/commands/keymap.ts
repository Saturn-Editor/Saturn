import { signal } from '@preact/signals';
import { bindingFor, formatBinding, KEYMAP_ACTIONS, matchesBinding, type KeymapId } from '@shared/keymaps';

export const isMac = navigator.userAgent.includes('Mac');

/** The keymap chosen in Settings, kept in sync across windows. */
export const keymapId = signal<KeymapId>('os');

/** Loads the keymap setting and follows changes to it. Call once per window before rendering. */
export async function followKeymap(): Promise<void> {
  keymapId.value = (await window.saturn.settings.get()).keymap;
  window.saturn.settings.onChanged((s) => (keymapId.value = s.keymap));
}

/** An action's shortcut in the current keymap as people read it ("⌘⇧A"), or null if it has none. */
export function shortcutFor(actionId: string): string | null {
  const binding = bindingFor(actionId, keymapId.value, isMac);
  return binding ? formatBinding(binding, isMac) : null;
}

/** The action (of the given scope) whose shortcut in the current keymap matches this key press. */
export function actionForKey(e: KeyboardEvent, scope: 'app' | 'editor'): string | null {
  for (const action of KEYMAP_ACTIONS) {
    if (action.scope !== scope) continue;
    const binding = bindingFor(action.id, keymapId.value, isMac);
    if (binding && matchesBinding(e, binding, isMac)) return action.id;
  }
  return null;
}
