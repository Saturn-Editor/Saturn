import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { channel, type SaturnApi } from '@shared/api';
import type { WindowKind } from '@shared/types';

function arg(name: string): string | null {
  const prefix = `--saturn-${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? decodeURIComponent(found.slice(prefix.length)) : null;
}

function invoke(area: string, name: string) {
  return (...args: unknown[]) => ipcRenderer.invoke(channel(area, name), ...args);
}

function send(area: string, name: string) {
  return (...args: unknown[]) => ipcRenderer.send(channel(area, name), ...args);
}

function listen<A extends unknown[]>(area: string, name: string) {
  return (cb: (...args: A) => void) => {
    const handler = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as A));
    ipcRenderer.on(channel(area, name), handler);
    return () => void ipcRenderer.removeListener(channel(area, name), handler);
  };
}

const api: SaturnApi = {
  window: {
    kind: (arg('window') ?? 'welcome') as WindowKind,
    projectPath: arg('project'),
    section: arg('section'),
    setDirty: send('window', 'setDirty'),
    close: send('window', 'close'),
    onSaveAll: listen('window', 'saveAll'),
  },
  windows: {
    openSettings: send('windows', 'openSettings'),
    openNewProject: send('windows', 'openNewProject'),
    openWelcome: send('windows', 'openWelcome'),
    openMarketplace: send('windows', 'openMarketplace'),
  },
  languages: {
    list: invoke('languages', 'list'),
    installDialog: invoke('languages', 'installDialog'),
    uninstall: invoke('languages', 'uninstall'),
    grammar: invoke('languages', 'grammar'),
    grammarByScope: invoke('languages', 'grammarByScope'),
    complete: invoke('languages', 'complete'),
    hover: invoke('languages', 'hover'),
    definition: invoke('languages', 'definition'),
    symbols: invoke('languages', 'symbols'),
    references: invoke('languages', 'references'),
    rename: invoke('languages', 'rename'),
    format: invoke('languages', 'format'),
    signatureHelp: invoke('languages', 'signatureHelp'),
    syncDocument: invoke('languages', 'syncDocument'),
    closeDocument: invoke('languages', 'closeDocument'),
    onDiagnostics: listen('languages', 'diagnostics'),
  },
  extensions: {
    list: invoke('extensions', 'list'),
    installDialog: invoke('extensions', 'installDialog'),
    uninstall: invoke('extensions', 'uninstall'),
  },
  modules: {
    setEnabled: invoke('modules', 'setEnabled'),
    settings: invoke('modules', 'settings'),
    setSetting: invoke('modules', 'setSetting'),
    onSettingsChanged: listen('modules', 'settingsChanged'),
    snapshot: invoke('modules', 'snapshot'),
    onChanged: listen('modules', 'changed'),
    runCommand: invoke('modules', 'runCommand'),
    treeChildren: invoke('modules', 'treeChildren'),
    treeAction: invoke('modules', 'treeAction'),
    onTreeRefresh: listen('modules', 'treeRefresh'),
    renderPreview: invoke('modules', 'renderPreview'),
    templateFile: invoke('modules', 'templateFile'),
    onOpenFile: listen('modules', 'openFile'),
    onMessage: listen('modules', 'message'),
    onRunInTerminal: listen('modules', 'runInTerminal'),
  },
  notifications: {
    list: invoke('notifications', 'list'),
    dismiss: invoke('notifications', 'dismiss'),
    clear: invoke('notifications', 'clear'),
    markAllRead: invoke('notifications', 'markAllRead'),
    act: invoke('notifications', 'act'),
    onChanged: listen('notifications', 'changed'),
  },
  debug: {
    state: invoke('debug', 'state'),
    breakpoints: invoke('debug', 'breakpoints'),
    setBreakpoints: invoke('debug', 'setBreakpoints'),
    start: invoke('debug', 'start'),
    stop: invoke('debug', 'stop'),
    continue: invoke('debug', 'continue'),
    next: invoke('debug', 'next'),
    stepIn: invoke('debug', 'stepIn'),
    stepOut: invoke('debug', 'stepOut'),
    pause: invoke('debug', 'pause'),
    selectFrame: invoke('debug', 'selectFrame'),
    variables: invoke('debug', 'variables'),
    evaluate: invoke('debug', 'evaluate'),
    onChanged: listen('debug', 'changed'),
    onOutput: listen('debug', 'output'),
  },
  updates: {
    status: invoke('updates', 'status'),
    check: invoke('updates', 'check'),
    install: invoke('updates', 'install'),
    onChanged: listen('updates', 'changed'),
  },
  git: {
    status: invoke('git', 'status'),
    log: invoke('git', 'log'),
    show: invoke('git', 'show'),
    branches: invoke('git', 'branches'),
    init: invoke('git', 'init'),
    stage: invoke('git', 'stage'),
    unstage: invoke('git', 'unstage'),
    commit: invoke('git', 'commit'),
    checkout: invoke('git', 'checkout'),
    createBranch: invoke('git', 'createBranch'),
    push: invoke('git', 'push'),
    pull: invoke('git', 'pull'),
    diff: invoke('git', 'diff'),
    deleteBranch: invoke('git', 'deleteBranch'),
    renameBranch: invoke('git', 'renameBranch'),
    remoteBranches: invoke('git', 'remoteBranches'),
    merge: invoke('git', 'merge'),
    abortOperation: invoke('git', 'abortOperation'),
    continueOperation: invoke('git', 'continueOperation'),
    rebase: invoke('git', 'rebase'),
    cherryPick: invoke('git', 'cherryPick'),
    revert: invoke('git', 'revert'),
    tags: invoke('git', 'tags'),
    createTag: invoke('git', 'createTag'),
    deleteTag: invoke('git', 'deleteTag'),
    renameTag: invoke('git', 'renameTag'),
    pushTags: invoke('git', 'pushTags'),
    workingDiff: invoke('git', 'workingDiff'),
    applyHunk: invoke('git', 'applyHunk'),
    resolveWith: invoke('git', 'resolveWith'),
    stashes: invoke('git', 'stashes'),
    stash: invoke('git', 'stash'),
    applyStash: invoke('git', 'applyStash'),
    dropStash: invoke('git', 'dropStash'),
    remotes: invoke('git', 'remotes'),
    addRemote: invoke('git', 'addRemote'),
    removeRemote: invoke('git', 'removeRemote'),
    pushTo: invoke('git', 'pushTo'),
    answerCredential: invoke('git', 'answerCredential'),
    onCredentialPrompt: listen('git', 'credentialPrompt'),
    onChanged: listen('git', 'changed'),
  },
  app: {
    info: invoke('app', 'info'),
    openFolder: invoke('app', 'openFolder'),
    reset: invoke('app', 'reset'),
  },
  settings: {
    get: invoke('settings', 'get'),
    update: invoke('settings', 'update'),
    onChanged: listen('settings', 'changed'),
  },
  marketplace: {
    list: invoke('marketplace', 'list'),
    installLanguage: invoke('marketplace', 'installLanguage'),
    installExtension: invoke('marketplace', 'installExtension'),
    installTheme: invoke('marketplace', 'installTheme'),
  },
  projects: {
    recent: invoke('projects', 'recent'),
    openDialog: invoke('projects', 'openDialog'),
    openPath: invoke('projects', 'openPath'),
    removeRecent: invoke('projects', 'removeRecent'),
    pickFolder: invoke('projects', 'pickFolder'),
    pickFile: invoke('projects', 'pickFile'),
    clone: invoke('projects', 'clone'),
    create: invoke('projects', 'create'),
    defaultParentDir: invoke('projects', 'defaultParentDir'),
  },
  themes: {
    list: invoke('themes', 'list'),
    active: invoke('themes', 'active'),
    setActive: invoke('themes', 'setActive'),
    mode: invoke('themes', 'mode'),
    setMode: invoke('themes', 'setMode'),
    syncWithOs: invoke('themes', 'syncWithOs'),
    setSyncWithOs: invoke('themes', 'setSyncWithOs'),
    installDialog: invoke('themes', 'installDialog'),
    uninstall: invoke('themes', 'uninstall'),
    onChanged: listen('themes', 'changed'),
    onListChanged: listen('themes', 'listChanged'),
  },
  fs: {
    readDir: invoke('fs', 'readDir'),
    readFile: invoke('fs', 'readFile'),
    writeFile: invoke('fs', 'writeFile'),
    createFile: invoke('fs', 'createFile'),
    createDir: invoke('fs', 'createDir'),
    rename: invoke('fs', 'rename'),
    trash: invoke('fs', 'trash'),
    reveal: invoke('fs', 'reveal'),
    onChanged: listen('fs', 'changed'),
  },
  layout: {
    load: invoke('layout', 'load'),
    save: invoke('layout', 'save'),
  },
  terminal: {
    create: invoke('terminal', 'create'),
    write: send('terminal', 'write'),
    resize: send('terminal', 'resize'),
    kill: send('terminal', 'kill'),
    onData: listen('terminal', 'data'),
    onExit: listen('terminal', 'exit'),
  },
  run: {
    list: invoke('run', 'list'),
    addCustom: invoke('run', 'addCustom'),
    removeCustom: invoke('run', 'removeCustom'),
    selected: invoke('run', 'selected'),
    select: invoke('run', 'select'),
  },
} as SaturnApi;

contextBridge.exposeInMainWorld('saturn', api);
