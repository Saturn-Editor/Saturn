import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }));

const { NotebookCrypto } = await import('../../../src/main/Notebooks/NotebookCrypto');
const { FileStore } = await import('../../../src/main/Store/FileStore');

function crypto() {
  const dir = mkdtempSync(join(tmpdir(), 'saturn-keys-'));
  const remembered = new FileStore<Record<string, string>>(join(dir, 'keys.json'), {}, (v): v is Record<string, string> => typeof v === 'object' && v !== null);
  const changes: string[] = [];
  return {
    project: new NotebookCrypto(remembered).forProjectType((_root, state) => changes.push(state), async () => void changes.push('removing')),
    changes,
  };
}

describe('project type encryption', () => {
  it('encrypts and decrypts values with the project key, kept in .saturn', async () => {
    const root = mkdtempSync(join(tmpdir(), 'saturn-project-'));
    const { project, changes } = crypto();
    await project.enableKeyOnly(root, 'correct horse', false);
    expect(existsSync(join(root, '.saturn', 'encryption.json'))).toBe(true);
    expect(await project.decryptText(root, await project.encryptText(root, 's3cret'))).toBe('s3cret');
    expect(changes).toContain('unlocked');
  });

  it('lets the extension decrypt its values before the key is removed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'saturn-project-'));
    const { project, changes } = crypto();
    await project.enableKeyOnly(root, 'correct horse', false);
    const sealed = await project.encryptText(root, 'api-key');
    await project.disableKeyOnly(root, 'correct horse');
    expect(changes).toContain('removing');
    expect(changes.indexOf('removing')).toBeLessThan(changes.lastIndexOf('none'));
    expect(existsSync(join(root, '.saturn', 'encryption.json'))).toBe(false);
    expect(sealed).not.toContain('api-key');
  });

  it('refuses while locked, and checks the password', async () => {
    const root = mkdtempSync(join(tmpdir(), 'saturn-project-'));
    const { project } = crypto();
    await project.enableKeyOnly(root, 'correct horse', false);
    await project.lock(root);
    await expect(project.encryptText(root, 'x')).rejects.toThrow('This project is locked');
    await expect(project.unlock(root, 'wrong password', false)).rejects.toThrow('Wrong password');
    await expect(project.disableKeyOnly(root, 'wrong password')).rejects.toThrow('Wrong password');
    expect(existsSync(join(root, '.saturn', 'encryption.json'))).toBe(true);
  });
});
