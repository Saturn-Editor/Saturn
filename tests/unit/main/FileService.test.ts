import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FileService } from '../../../src/main/Services/FileService';

let root: string;
let files: FileService;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'saturn-fs-'));
  files = new FileService(root);
});

describe('FileService', () => {
  it('lists folders first, sorted, without .git', async () => {
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'b.txt'), '');
    writeFileSync(join(root, 'a10.txt'), '');
    writeFileSync(join(root, 'a2.txt'), '');
    expect((await files.readDir(root)).map((e) => e.name)).toEqual(['src', 'a2.txt', 'a10.txt', 'b.txt']);
  });

  it('refuses paths outside the project', async () => {
    await expect(files.readFile(join(root, '..', 'elsewhere.txt'))).rejects.toThrow('outside the project');
    expect(() => files.entry(root)).toThrow("That's the project folder");
  });

  it('creates files and folders without overwriting', async () => {
    await files.createFile(join(root, 'a.txt'), 'hi');
    await expect(files.createFile(join(root, 'a.txt'))).rejects.toThrow('already exists');
    await files.createDir(join(root, 'dir'));
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('hi');
  });

  it('renames in place and rejects slashes', async () => {
    writeFileSync(join(root, 'old.txt'), 'x');
    expect(await files.rename(join(root, 'old.txt'), 'new.txt')).toBe(join(root, 'new.txt'));
    await expect(files.rename(join(root, 'new.txt'), 'a/b')).rejects.toThrow('without slashes');
  });

  it('moves into a folder and never overwrites', async () => {
    mkdirSync(join(root, 'dest'));
    writeFileSync(join(root, 'f.txt'), 'one');
    writeFileSync(join(root, 'dest', 'g.txt'), '');
    expect(await files.move(join(root, 'f.txt'), join(root, 'dest'))).toBe(join(root, 'dest', 'f.txt'));
    writeFileSync(join(root, 'g.txt'), 'two');
    await expect(files.move(join(root, 'g.txt'), join(root, 'dest'))).rejects.toThrow('already exists');
  });

  it("won't move a folder into itself", async () => {
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    await expect(files.move(join(root, 'a'), join(root, 'a', 'b'))).rejects.toThrow('into itself');
  });

  it('copies with a free "copy" name when the name is taken', async () => {
    writeFileSync(join(root, 'note.md'), 'n');
    expect(await files.copy(join(root, 'note.md'), root)).toBe(join(root, 'note copy.md'));
    expect(await files.copy(join(root, 'note.md'), root)).toBe(join(root, 'note copy 2.md'));
    mkdirSync(join(root, 'folder'));
    writeFileSync(join(root, 'folder', 'x.txt'), 'x');
    const copied = await files.copy(join(root, 'folder'), root);
    expect(existsSync(join(copied, 'x.txt'))).toBe(true);
  });

  it('reads text, binary and line endings', async () => {
    writeFileSync(join(root, 'crlf.txt'), 'a\r\nb');
    writeFileSync(join(root, 'bin.dat'), Buffer.from([1, 0, 2]));
    expect(await files.readFile(join(root, 'crlf.txt'))).toMatchObject({ kind: 'text', eol: 'CRLF' });
    expect(await files.readFile(join(root, 'bin.dat'))).toEqual({ kind: 'binary' });
  });
});
