export type KeymapId = 'os' | 'intellij' | 'visualstudio' | 'vscode';

export const KEYMAPS: { id: KeymapId; label: string }[] = [
  { id: 'os', label: 'Current OS' },
  { id: 'intellij', label: 'IntelliJ' },
  { id: 'visualstudio', label: 'Visual Studio' },
  { id: 'vscode', label: 'VS Code' },
];

/**
 * A key combination in CodeMirror's syntax: modifiers joined by "-", then the key, e.g. "Mod-Shift-a",
 * "Alt-F12", "Ctrl-`". "Mod" is Cmd on macOS and Ctrl elsewhere; "Ctrl" is always the Control key.
 * Where a keymap differs by platform, give `{ mac, other }`.
 */
type Binding = string | { mac: string; other: string };

export interface KeymapAction {
  id: string;
  title: string;
  /** "app" actions work anywhere in the window; "editor" ones only while typing in a file. */
  scope: 'app' | 'editor';
  bindings: Partial<Record<KeymapId, Binding>>;
}

/** Every action with a shortcut, and its key in each keymap (left out where that keymap has none). */
export const KEYMAP_ACTIONS: KeymapAction[] = [
  {
    id: 'core.searchActions', title: 'Search Actions', scope: 'app',
    bindings: { os: 'Mod-Shift-a', intellij: 'Mod-Shift-a', visualstudio: 'Ctrl-q', vscode: 'Mod-Shift-p' },
  },
  {
    id: 'core.saveFile', title: 'Save File', scope: 'app',
    bindings: { os: 'Mod-s', visualstudio: 'Ctrl-s', vscode: 'Mod-s' },
  },
  {
    id: 'core.saveAll', title: 'Save All', scope: 'app',
    bindings: { os: { mac: 'Mod-Alt-s', other: 'Ctrl-Shift-s' }, intellij: 'Mod-s', visualstudio: 'Ctrl-Shift-s', vscode: 'Mod-Alt-s' },
  },
  {
    id: 'core.closeTab', title: 'Close Tab', scope: 'app',
    bindings: { os: 'Mod-w', intellij: { mac: 'Mod-w', other: 'Ctrl-F4' }, visualstudio: 'Ctrl-F4', vscode: 'Mod-w' },
  },
  {
    id: 'core.openSettings', title: 'Open Settings', scope: 'app',
    bindings: { os: 'Mod-,', intellij: { mac: 'Mod-,', other: 'Ctrl-Alt-s' }, vscode: 'Mod-,' },
  },
  {
    id: 'core.toggleProject', title: 'Toggle Project', scope: 'app',
    bindings: { os: 'Mod-1', intellij: { mac: 'Mod-1', other: 'Alt-1' }, visualstudio: 'Ctrl-Alt-l', vscode: 'Mod-Shift-e' },
  },
  {
    id: 'core.toggleTerminal', title: 'Toggle Terminal', scope: 'app',
    bindings: { os: 'Ctrl-`', intellij: 'Alt-F12', visualstudio: 'Ctrl-`', vscode: 'Ctrl-`' },
  },
  {
    id: 'core.newTerminal', title: 'New Terminal', scope: 'app',
    bindings: { os: 'Ctrl-Shift-`', vscode: 'Ctrl-Shift-`' },
  },
  {
    id: 'core.startDebugging', title: 'Start Debugging / Continue', scope: 'app',
    bindings: { os: 'F5', intellij: { mac: 'Ctrl-d', other: 'Shift-F9' }, visualstudio: 'F5', vscode: 'F5' },
  },
  {
    id: 'core.stopDebugging', title: 'Stop Debugging', scope: 'app',
    bindings: { os: 'Shift-F5', intellij: 'Mod-F2', visualstudio: 'Shift-F5', vscode: 'Shift-F5' },
  },
  {
    id: 'core.stepOver', title: 'Step Over', scope: 'app',
    bindings: { os: 'F10', intellij: 'F8', visualstudio: 'F10', vscode: 'F10' },
  },
  {
    id: 'core.stepInto', title: 'Step Into', scope: 'app',
    bindings: { os: 'F11', intellij: 'F7', visualstudio: 'F11', vscode: 'F11' },
  },
  {
    id: 'core.stepOut', title: 'Step Out', scope: 'app',
    bindings: { os: 'Shift-F11', intellij: 'Shift-F8', visualstudio: 'Shift-F11', vscode: 'Shift-F11' },
  },
  {
    id: 'core.splitEditor', title: 'Split Editor', scope: 'app',
    bindings: { os: 'Mod-\\', vscode: 'Mod-\\' },
  },
  {
    id: 'editor.toggleBreakpoint', title: 'Toggle Breakpoint', scope: 'editor',
    bindings: { os: 'F9', intellij: 'Mod-F8', visualstudio: 'F9', vscode: 'F9' },
  },
  {
    id: 'editor.find', title: 'Find', scope: 'editor',
    bindings: { os: 'Mod-f', intellij: 'Mod-f', visualstudio: 'Ctrl-f', vscode: 'Mod-f' },
  },
  {
    id: 'editor.replace', title: 'Replace', scope: 'editor',
    bindings: { os: { mac: 'Mod-Alt-f', other: 'Ctrl-h' }, intellij: 'Mod-r', visualstudio: 'Ctrl-h', vscode: { mac: 'Mod-Alt-f', other: 'Ctrl-h' } },
  },
  {
    id: 'editor.gotoLine', title: 'Go to Line', scope: 'editor',
    bindings: { os: { mac: 'Mod-l', other: 'Ctrl-g' }, intellij: { mac: 'Mod-l', other: 'Ctrl-g' }, visualstudio: 'Ctrl-g', vscode: 'Ctrl-g' },
  },
  {
    id: 'editor.gotoDefinition', title: 'Go to Definition', scope: 'editor',
    bindings: { os: 'F12', intellij: 'Mod-b', visualstudio: 'F12', vscode: 'F12' },
  },
  {
    id: 'editor.findReferences', title: 'Find Usages', scope: 'editor',
    bindings: { os: 'Shift-F12', intellij: 'Alt-F7', visualstudio: 'Shift-F12', vscode: 'Shift-F12' },
  },
  {
    id: 'editor.rename', title: 'Rename Symbol', scope: 'editor',
    bindings: { os: 'F2', intellij: 'Shift-F6', visualstudio: 'F2', vscode: 'F2' },
  },
  {
    id: 'editor.formatDocument', title: 'Format Document', scope: 'editor',
    bindings: { os: 'Shift-Alt-f', intellij: 'Mod-Alt-l', visualstudio: 'Ctrl-Shift-f', vscode: 'Shift-Alt-f' },
  },
  {
    id: 'editor.duplicateLine', title: 'Duplicate Line', scope: 'editor',
    bindings: { os: 'Shift-Alt-ArrowDown', intellij: 'Mod-d', visualstudio: 'Ctrl-d', vscode: 'Shift-Alt-ArrowDown' },
  },
  {
    id: 'editor.deleteLine', title: 'Delete Line', scope: 'editor',
    bindings: { os: 'Mod-Shift-k', intellij: { mac: 'Mod-Backspace', other: 'Ctrl-y' }, visualstudio: 'Ctrl-Shift-l', vscode: 'Mod-Shift-k' },
  },
  {
    id: 'editor.moveLineUp', title: 'Move Line Up', scope: 'editor',
    bindings: { os: 'Alt-ArrowUp', intellij: 'Alt-Shift-ArrowUp', visualstudio: 'Alt-ArrowUp', vscode: 'Alt-ArrowUp' },
  },
  {
    id: 'editor.moveLineDown', title: 'Move Line Down', scope: 'editor',
    bindings: { os: 'Alt-ArrowDown', intellij: 'Alt-Shift-ArrowDown', visualstudio: 'Alt-ArrowDown', vscode: 'Alt-ArrowDown' },
  },
];

/**
 * A user's own keymap: a copy of a built-in one with some shortcuts changed. `bindings` holds only the
 * changes; a null value means "no shortcut" for that action.
 */
export interface CustomKeymap {
  id: string;
  name: string;
  base: KeymapId;
  bindings: Record<string, string | null>;
}

/** The selected keymap: a built-in id, or "custom:<id>" for one of the user's own. */
export type KeymapChoice = KeymapId | `custom:${string}`;

export const CUSTOM_PREFIX = 'custom:';

/** The key for an action in a built-in keymap on this platform, or null if it has none. */
export function bindingFor(actionId: string, keymap: KeymapId, isMac: boolean): string | null {
  const binding = KEYMAP_ACTIONS.find((a) => a.id === actionId)?.bindings[keymap];
  if (!binding) return null;
  return typeof binding === 'string' ? binding : isMac ? binding.mac : binding.other;
}

/** The key for an action in the selected keymap (built-in or custom), or null if it has none. */
export function resolveBinding(actionId: string, choice: string, customs: CustomKeymap[], isMac: boolean): string | null {
  if (!choice.startsWith(CUSTOM_PREFIX)) return bindingFor(actionId, choice as KeymapId, isMac);
  const custom = customs.find((c) => `${CUSTOM_PREFIX}${c.id}` === choice);
  if (!custom) return bindingFor(actionId, 'os', isMac);
  return actionId in custom.bindings ? custom.bindings[actionId] : bindingFor(actionId, custom.base, isMac);
}

const CODE_KEYS: Record<string, string> = { Backquote: '`', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Quote: "'" };

/**
 * A key press as a binding ("Mod-Shift-k"), for recording a custom shortcut. Null for a lone modifier
 * key. Printable keys use the physical key, so Shift and Alt don't change them.
 */
export function bindingFromKeyPress(e: KeyPress, isMac: boolean): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null;
  let key = e.key;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code];
  const mods = [
    (isMac ? e.metaKey : e.ctrlKey) && 'Mod',
    isMac && e.ctrlKey && 'Ctrl',
    e.altKey && 'Alt',
    e.shiftKey && 'Shift',
  ].filter(Boolean);
  return [...mods, key].join('-');
}

const MAC_SYMBOLS: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' };
const KEY_NAMES: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: '⌫' };

/** A binding as people read it: "⌘⇧A" on macOS, "Ctrl+Shift+A" elsewhere. */
export function formatBinding(binding: string, isMac: boolean): string {
  const parts = binding.split(/-(?!$)/);
  const key = parts.pop()!;
  const shown = KEY_NAMES[key] && isMac ? KEY_NAMES[key] : key.length === 1 ? key.toUpperCase() : key;
  if (isMac) return parts.map((m) => MAC_SYMBOLS[m] ?? m).join('') + shown;
  return [...parts.map((m) => (m === 'Mod' ? 'Ctrl' : m)), shown].join('+');
}

/** The parts of a DOM KeyboardEvent the matcher reads (shared code also builds for main, which has no DOM types). */
export interface KeyPress {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Does a key press match a binding? Printable keys compare by physical key, so Shift and Alt can't change them. */
export function matchesBinding(e: KeyPress, binding: string, isMac: boolean): boolean {
  const parts = binding.split(/-(?!$)/);
  const key = parts.pop()!;
  const want = new Set(parts);
  const ctrl = want.has('Ctrl') || (want.has('Mod') && !isMac);
  const meta = want.has('Mod') && isMac;
  if (e.ctrlKey !== ctrl || e.metaKey !== meta || e.altKey !== want.has('Alt') || e.shiftKey !== want.has('Shift')) return false;
  if (/^[a-z]$/i.test(key)) return e.code === `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}`;
  const code = Object.entries(CODE_KEYS).find(([, k]) => k === key)?.[0];
  if (code) return e.code === code;
  return e.key === key;
}
