import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchSaturn } from './app';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function openProject(prepare?: (dir: string, userData: string) => void): Promise<{ app: ElectronApplication; editor: Page; dir: string }> {
  const userData = mkdtempSync(join(tmpdir(), 'saturn-data-'));
  const parent = mkdtempSync(join(tmpdir(), 'saturn proj '));
  const dir = join(parent, 'demo');
  mkdirSync(dir);
  prepare?.(dir, userData);
  writeFileSync(join(userData, 'recent-projects.json'), JSON.stringify([{ path: dir, name: 'demo', openedAt: Date.now(), languageIds: [] }]));
  const { app } = await launchSaturn(userData);
  const welcome = await app.firstWindow();
  const editorPromise = app.waitForEvent('window');
  await welcome.getByText('demo', { exact: true }).first().click();
  const editor = await editorPromise;
  await expect(editor.getByTestId('screen-editor')).toBeVisible();
  return { app, editor, dir };
}

const tree = (page: Page, name: string) => page.getByTestId('project-tree').getByRole('treeitem', { name, exact: true });

test('explorer: copy, paste, duplicate, rename, delete and undo', async () => {
  const { app, editor, dir } = await openProject((d) => {
    writeFileSync(join(d, 'a.txt'), 'A');
    mkdirSync(join(d, 'sub'));
  });
  await tree(editor, 'a.txt').click({ button: 'right' });
  await editor.getByTestId('menu-copy').click();
  await tree(editor, 'sub').click({ button: 'right' });
  await editor.getByTestId('menu-paste').click();
  await expect.poll(() => existsSync(join(dir, 'sub', 'a.txt'))).toBe(true);

  await tree(editor, 'a.txt').last().click();
  await editor.getByTestId('project-tree').press(`${MOD}+d`);
  await expect.poll(() => existsSync(join(dir, 'a copy.txt'))).toBe(true);

  await tree(editor, 'a copy.txt').click();
  await editor.getByTestId('project-tree').press('F2');
  await editor.getByTestId('new-file-name').fill('b.txt');
  await editor.getByTestId('new-file-name').press('Enter');
  await expect.poll(() => existsSync(join(dir, 'b.txt'))).toBe(true);

  await tree(editor, 'b.txt').click({ button: 'right' });
  await editor.getByTestId('menu-delete').click();
  await expect.poll(() => existsSync(join(dir, 'b.txt'))).toBe(false);
  await editor.getByTestId('undo-button').click();
  await expect.poll(() => existsSync(join(dir, 'b.txt'))).toBe(true);
  await app.close();
});

test('notebooks: pages, sub-pages and renames', async () => {
  const { app } = await launchSaturn();
  const welcome = await app.firstWindow();
  await welcome.getByRole('button', { name: 'Notebooks' }).click();
  await welcome.getByTestId('notebook-new').click();
  await welcome.getByTestId('notebook-new-name').fill('Ideas');
  const nbPromise = app.waitForEvent('window');
  await welcome.getByTestId('notebook-create').click();
  const nb = await nbPromise;
  await expect(nb.getByTestId('screen-editor')).toBeVisible();
  await expect(nb.getByTestId('panel-project')).toContainText('Notebook');

  await tree(nb, 'Untitled').click();
  await expect(nb.getByTestId('notebook-editor')).toBeVisible();
  await expect(nb.getByRole('tablist')).toHaveCount(0);
  await nb.locator('.notebook-content').click();
  await nb.keyboard.type('Hello');

  await tree(nb, 'Untitled').click({ button: 'right' });
  await nb.getByTestId('menu-subpage').click();
  await expect(tree(nb, 'Untitled')).toHaveCount(2);

  await tree(nb, 'Ideas').click({ button: 'right' });
  await nb.getByTestId('menu-new').click();
  await nb.getByTestId('new-notebook.page').click();
  await nb.getByTestId('new-file-name').fill('Untitled');
  await nb.getByTestId('new-file-name').press('Enter');
  await expect(tree(nb, 'Untitled 2')).toBeVisible();

  await tree(nb, 'Untitled').first().click();
  await nb.getByTestId('notebook-page-title').fill('Plans');
  await nb.getByTestId('notebook-page-title').press('Enter');
  await expect(tree(nb, 'Plans')).toBeVisible();
  await expect(nb.getByTestId('project-tree').getByRole('treeitem', { name: 'Plans' })).toHaveCount(1);
  await expect(nb.locator('.notebook-content')).toContainText('Hello');
  await app.close();
});

test('notebooks: table toolbar and code block languages', async () => {
  const { app } = await launchSaturn();
  const welcome = await app.firstWindow();
  await welcome.getByRole('button', { name: 'Notebooks' }).click();
  await welcome.getByTestId('notebook-new').click();
  await welcome.getByTestId('notebook-new-name').fill('Blocks');
  const nbPromise = app.waitForEvent('window');
  await welcome.getByTestId('notebook-create').click();
  const nb = await nbPromise;
  await tree(nb, 'Untitled').click();
  const content = nb.locator('.notebook-content');
  await content.click();

  await nb.keyboard.type('/table');
  await nb.keyboard.press('Enter');
  await expect(content.locator('table tr')).toHaveCount(3);
  const toolbar = nb.getByTestId('notebook-table-toolbar');
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole('button', { name: 'Row below' }).click();
  await expect(content.locator('table tr')).toHaveCount(4);
  await toolbar.getByRole('button', { name: 'Column right' }).click();
  await expect(content.locator('table tr').first().locator('th, td')).toHaveCount(4);
  await toolbar.getByRole('button', { name: 'Delete table' }).click();
  await expect(content.locator('table')).toHaveCount(0);

  await content.click();
  await nb.keyboard.type('/code');
  await nb.keyboard.press('Enter');
  await nb.keyboard.type('const x = 1;');
  const block = content.locator('.notebook-code');
  await block.hover();
  const picker = block.getByTestId('code-language');
  await expect(picker).toBeVisible();
  await expect(picker.locator('option').first()).toHaveText('Plain text');
  await app.close();
});

test('language versions in the status bar, and language settings under Languages', async () => {
  const { app, editor } = await openProject((dir, userData) => {
    writeFileSync(join(dir, 'main.fake'), 'hello\n');
    const mod = join(userData, 'languages', 'fake-lang');
    mkdirSync(mod, { recursive: true });
    writeFileSync(join(mod, 'saturn-language.json'), JSON.stringify({
      id: 'fake-lang', name: 'Fake Language', version: '1.0.0', saturnApi: '^0.3', main: 'module.js',
      activationEvents: ['onLanguage:fake'],
      contributes: {
        languages: [{ id: 'fake', name: 'Fake', extensions: ['.fake'], versions: true }],
        settings: [{ id: 'flavour', label: 'Flavour', type: 'text', default: '' }],
      },
    }));
    writeFileSync(join(mod, 'module.js'), `
export function activate(saturn) {
  saturn.languages.registerVersions('fake', {
    list: () => [{ id: 'v1', label: '1', detail: '/opt/fake1' }, { id: 'v2', label: '2', detail: '/opt/fake2' }],
    onChange: ({ version }) => saturn.window.showMessage('Using Fake ' + version.label),
  });
}
`);
  });
  await tree(editor, 'main.fake').click();
  const status = editor.getByTestId('status-language');
  await expect(status).toHaveText('Fake');
  await status.click();
  await editor.getByTestId('language-version-v2').click();
  await expect(status).toHaveText('Fake 2');
  await expect(editor.getByTestId('status-notice')).toContainText('Using Fake 2');
  await app.close();
});

test('settings: new sections and built-in themes', async () => {
  const { app } = await launchSaturn();
  const welcome = await app.firstWindow();
  await welcome.getByRole('button', { name: 'Settings' }).click();
  const settings = welcome.getByTestId('welcome-settings');
  for (const tab of ['Languages', 'Extensions', 'Notebooks', 'Advanced']) await expect(settings.getByRole('tab', { name: tab })).toBeVisible();

  await settings.getByRole('tab', { name: 'Notebooks' }).click();
  await expect(welcome.getByTestId('settings-notebooks')).toContainText('Default page style');
  await expect(welcome.getByTestId('notebook-style-preview')).toContainText('Meeting notes');
  await welcome.getByTestId('settings-notebooks').getByRole('radio', { name: 'Serif', exact: true }).click();
  await expect(welcome.getByTestId('notebook-style-preview')).toHaveClass(/font-serif/);
  await welcome.getByTestId('settings-notebooks').getByRole('button', { name: 'Theme settings' }).click();
  await expect(settings.getByRole('radio', { name: /High Contrast/ })).toBeVisible();

  await settings.getByRole('tab', { name: 'Advanced' }).click();
  await expect(settings.getByRole('radio', { name: 'Side by side' })).toHaveAttribute('aria-checked', 'true');
  await expect(settings.getByRole('radio', { name: 'In the project window' })).toHaveAttribute('aria-checked', 'true');
  await expect(settings.getByTestId('projects-folder')).toBeVisible();

  await settings.getByRole('tab', { name: 'Appearance' }).click();
  await settings.getByRole('radio', { name: /High Contrast/ }).click();
  await expect(welcome.locator('html')).toHaveAttribute('data-theme-id', 'high-contrast');
  await settings.getByRole('radio', { name: /Dyslexia Friendly/ }).click();
  await expect(welcome.locator('html')).toHaveAttribute('data-theme-id', 'dyslexia-friendly');
  await app.close();
});

test('an incomplete theme still loads and posts a notification', async () => {
  const { app, editor } = await openProject((_dir, userData) => {
    mkdirSync(join(userData, 'themes', 'half'), { recursive: true });
    writeFileSync(join(userData, 'themes', 'half', 'theme.json'), JSON.stringify({ id: 'half', name: 'Half', dark: { colors: { text: 'white' }, syntax: [] } }));
  });
  await editor.getByTestId('notifications').click();
  await expect(editor.getByTestId('notifications-menu')).toContainText('The Half theme is incomplete');
  await app.close();
});

test('tests panel runs tests from a module', async () => {
  const { app, editor } = await openProject((dir, userData) => {
    writeFileSync(join(dir, 'math.test.js'), 'test("adds")\ntest("breaks")\n');
    const mod = join(userData, 'extensions', 'fake-tests');
    mkdirSync(mod, { recursive: true });
    writeFileSync(join(mod, 'saturn-extension.json'), JSON.stringify({ id: 'fake-tests', name: 'Fake tests', version: '1.0.0', saturnApi: '^0.3', main: 'extension.js', contributes: { tests: true } }));
    writeFileSync(join(mod, 'extension.js'), `
export function activate(saturn) {
  saturn.tests.registerController('fake', {
    label: 'Fake',
    discover: ({ projectPath }) => [{ id: 'file', label: 'math.test.js', path: projectPath + '/math.test.js', line: 1, children: [
      { id: 'adds', label: 'adds', path: projectPath + '/math.test.js', line: 1 },
      { id: 'breaks', label: 'breaks', path: projectPath + '/math.test.js', line: 2 },
    ] }],
    supportsCoverage: true,
    run: async ({ ids, report, output, coverage, reportCoverage, projectPath }) => {
      if (coverage) reportCoverage([{ path: projectPath + '/math.test.js', covered: [1], uncovered: [2] }]);
      for (const id of ids ?? ['adds', 'breaks']) {
        report({ id, state: id === 'adds' ? 'passed' : 'failed', message: id === 'breaks' ? 'expected 2 to be 3' : undefined, durationMs: 1 });
      }
      output('ran ' + (ids ?? ['all']).join(',') + '\\n');
    },
    debug: () => ({ languageId: 'nothing-debugs-this', launch: {} }),
  });
}
`);
  });
  await editor.getByTestId('strip-tests').getByRole('button').click();
  const panel = editor.getByTestId('tests-panel');
  await expect(panel.getByRole('treeitem', { name: 'math.test.js' })).toBeVisible();
  await editor.getByTestId('tests-run-all').click();
  await expect(editor.getByTestId('tests-summary')).toHaveText('1 passed, 1 failed');
  await panel.getByRole('treeitem', { name: 'math.test.js' }).getByTestId('tree-chevron').click();
  await panel.getByRole('treeitem', { name: 'breaks' }).click();
  await expect(editor.getByTestId('tests-output')).toContainText('expected 2 to be 3');
  await expect(editor.locator('.cm-saturn-test-failed')).toBeVisible();

  await editor.getByTestId('tests-run-coverage').click();
  await expect(editor.getByTestId('tests-summary')).toContainText('50% of lines covered');
  await expect(editor.locator('.cm-saturn-covered:visible')).toHaveCount(1);
  await expect(editor.locator('.cm-saturn-uncovered:visible')).toHaveCount(1);
  await editor.getByTestId('tests-toggle-coverage').click();
  await expect(editor.locator('.cm-saturn-covered:visible')).toHaveCount(0);

  await panel.getByRole('treeitem', { name: 'adds' }).click();
  await editor.getByTestId('tests-save-set').click();
  await editor.getByTestId('tests-set-name-input').fill('Smoke');
  await editor.getByTestId('tests-set-name-input').press('Enter');
  await expect(panel.getByRole('treeitem', { name: 'breaks' })).toHaveCount(0);
  await expect(panel.getByRole('treeitem', { name: 'adds' })).toBeVisible();
  await editor.getByTestId('tests-run-all').click();
  await expect(editor.getByTestId('tests-output')).toContainText('ran adds');

  const addsRow = panel.getByRole('treeitem', { name: 'adds' }).locator('..');
  await addsRow.hover();
  await addsRow.getByTestId('test-debug-item').click();
  await expect(panel).toContainText("There's no debugger");
  await app.close();
});

test('tests panel: stopping a run and tests found while running', async () => {
  const { app, editor } = await openProject((dir, userData) => {
    const mod = join(userData, 'extensions', 'slow-tests');
    mkdirSync(mod, { recursive: true });
    writeFileSync(join(mod, 'saturn-extension.json'), JSON.stringify({ id: 'slow-tests', name: 'Slow tests', version: '1.0.0', saturnApi: '^0.3', main: 'extension.js', contributes: { tests: true } }));
    writeFileSync(join(mod, 'extension.js'), `
let stopped = false;
export function activate(saturn) {
  saturn.tests.registerController('slow', {
    label: 'Slow',
    discover: () => [{ id: 'suite', label: 'suite', children: [{ id: 'table', label: 'table' }, { id: 'hang', label: 'hang' }] }],
    run: ({ ids, signal, report }) => new Promise((resolve) => {
      report({ id: 'table [1]', label: 'table [1]', parentId: 'suite', state: 'passed' });
      if (ids && !ids.includes('hang')) return resolve();
      report({ id: 'hang', state: 'running' });
      signal.addEventListener('abort', () => resolve());
    }),
  });
}
`);
    writeFileSync(join(dir, 'x.txt'), '');
  });
  await editor.getByTestId('strip-tests').getByRole('button').click();
  const panel = editor.getByTestId('tests-panel');
  await panel.getByRole('treeitem', { name: 'suite' }).getByTestId('tree-chevron').click();
  await editor.getByTestId('tests-run-all').click();
  await expect(panel.getByRole('treeitem', { name: 'table [1]' })).toBeVisible();
  await expect(editor.getByTestId('tests-stop')).toBeVisible();
  await editor.getByTestId('tests-stop').click();
  await expect(editor.getByTestId('tests-run-all')).toBeVisible();
  await panel.getByRole('treeitem', { name: 'hang' }).click();
  await expect(editor.getByTestId('tests-output')).toContainText('Stopped');
  await app.close();
});

test('git: blame, file history and interactive rebase', async () => {
  const { app, editor } = await openProject((dir) => {
    const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args]);
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Tester');
    git('config', 'commit.gpgsign', 'false');
    for (const [n, text] of [['First', 'one\n'], ['Second', 'one\ntwo\n'], ['Third', 'one\ntwo\nthree\n']]) {
      writeFileSync(join(dir, 'a.txt'), text);
      git('add', 'a.txt');
      git('commit', '-q', '-m', n);
    }
  });
  await tree(editor, 'a.txt').click();
  await editor.locator('.cm-content').click({ button: 'right' });
  await editor.getByTestId('editor-menu-blame').click();
  await expect(editor.locator('.cm-saturn-blame-line').first()).toContainText('Tester');

  await editor.getByTestId('strip-git').getByRole('button').click();
  await editor.getByRole('tab', { name: 'File History' }).click();
  await expect(editor.getByTestId('history-commit')).toHaveCount(3);

  await editor.getByRole('tab', { name: 'Log' }).click();
  await editor.getByTestId('git-commit-row').last().click({ button: 'right' });
  await editor.getByTestId('commit-rebase').click();
  await expect(editor.getByTestId('rebase-row')).toHaveCount(2);
  await app.close();
});

test('debug panels: breakpoints list and toggle', async () => {
  const { app, editor } = await openProject((dir) => writeFileSync(join(dir, 'main.txt'), 'a\nb\nc\n'));
  await tree(editor, 'main.txt').click();
  await editor.locator('.cm-lineNumbers .cm-gutterElement', { hasText: /^2$/ }).click();
  await expect(editor.locator('.cm-saturn-breakpoint:visible')).toHaveCount(1);
  await editor.getByTestId('strip-debug').getByRole('button').click();
  const panel = editor.getByTestId('debug-panel');
  for (const tab of ['Call Stack', 'Variables', 'Console', 'Breakpoints', 'Diagnostics']) await expect(panel.getByRole('tab', { name: tab })).toBeVisible();
  await expect(editor.getByTestId('strip-breakpoints')).toHaveCount(0);
  await panel.getByRole('tab', { name: 'Diagnostics' }).click();
  await expect(editor.getByTestId('debug-diagnostics')).toContainText('CPU and memory graphs show here while you debug');
  await panel.getByRole('tab', { name: 'Breakpoints' }).click();
  const row = editor.getByTestId('breakpoint-row');
  await expect(row).toContainText('main.txt:2');
  await row.getByRole('checkbox').click();
  await expect(editor.locator('.cm-saturn-disabled:visible')).toHaveCount(1);
  await app.close();
});
