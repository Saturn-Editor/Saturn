import { describe, expect, it } from 'vitest';
import { baseName, errorText, parentOf } from '@renderer/helpers';
import { cleanTitle, isPagePath, pageTitle, subpageFolder } from '@renderer/notebooks/pages';
import { leaves } from '@renderer/panels/builtin/TestsController';

describe('helpers', () => {
  it('strips the IPC prefix from error messages', () => {
    expect(errorText(new Error("Error invoking remote method 'saturn:fs:move': Error: A file named x already exists"))).toBe('A file named x already exists');
  });

  it('splits paths with either separator', () => {
    expect(baseName('/a/b/c.txt')).toBe('c.txt');
    expect(baseName('C:\\a\\c.txt')).toBe('c.txt');
    expect(parentOf('/a/b/c.txt')).toBe('/a/b');
  });
});

describe('notebook pages', () => {
  it('names pages and their sub-page folders', () => {
    expect(isPagePath('/n/Meeting notes.snp')).toBe(true);
    expect(isPagePath('/n/notes.md')).toBe(false);
    expect(pageTitle('/n/Meeting notes.snp')).toBe('Meeting notes');
    expect(subpageFolder('/n/Meeting notes.snp')).toBe('/n/Meeting notes');
  });

  it('makes titles safe file names', () => {
    expect(cleanTitle('a/b: c?')).toBe('a-b- c-');
    expect(cleanTitle('   ')).toBe('Untitled');
  });
});

describe('tests tree', () => {
  it('expands groups to their leaf tests', () => {
    const tree = [{ id: 'file', label: 'f', children: [{ id: 'a', label: 'a' }, { id: 'g', label: 'g', children: [{ id: 'b', label: 'b' }] }] }, { id: 'c', label: 'c' }];
    expect(leaves(tree).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
});
