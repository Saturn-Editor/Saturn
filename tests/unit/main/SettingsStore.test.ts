import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SettingsStore } from '../../../src/main/Store/SettingsStore';

const store = () => new SettingsStore(join(mkdtempSync(join(tmpdir(), 'saturn-settings-')), 'settings.json'));

describe('settings', () => {
  it('has the new defaults', async () => {
    const s = await store().app();
    expect(s.diffLayout).toBe('split');
    expect(s.debugWindow).toBe('docked');
    expect(s.projectsFolder).toBeNull();
  });

  it('accepts valid values and ignores invalid ones', async () => {
    const settings = store();
    await settings.updateApp({ diffLayout: 'unified', debugWindow: 'separate', projectsFolder: '/tmp/projects' });
    await settings.updateApp({ diffLayout: 'sideways' as never, debugWindow: 'floating' as never, projectsFolder: 'relative/path' });
    const s = await settings.app();
    expect(s.diffLayout).toBe('unified');
    expect(s.debugWindow).toBe('separate');
    expect(s.projectsFolder).toBe('/tmp/projects');
  });

  it('clears the projects folder back to the default', async () => {
    const settings = store();
    await settings.updateApp({ projectsFolder: '/tmp/projects' });
    await settings.updateApp({ projectsFolder: null });
    expect((await settings.app()).projectsFolder).toBeNull();
  });

  it('requires an https marketplace address', async () => {
    await expect(store().updateApp({ marketplaceUrl: 'http://example.com/index.json' })).rejects.toThrow('https');
  });
});
