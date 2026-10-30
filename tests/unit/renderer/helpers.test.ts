import { describe, expect, it } from 'vitest';
import { baseName, errorText, parentOf } from '@renderer/helpers';
import { isPagePath, pageForLink, pageId, pageLink, subpageFolder } from '@renderer/notebooks/pages';
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
    expect(isPagePath('/n/k3f9x2ab.snp')).toBe(true);
    expect(isPagePath('/n/notes.md')).toBe(false);
    expect(pageId('/n/k3f9x2ab.snp')).toBe('k3f9x2ab');
    expect(subpageFolder('/n/k3f9x2ab.snp')).toBe('/n/k3f9x2ab');
  });

  it('links pages by id, wherever they are', () => {
    expect(pageLink('/n/a/k3f9x2ab.snp')).toBe('saturn-page:k3f9x2ab');
    expect(pageForLink('saturn-page:k3f9x2ab', { '/n/b/k3f9x2ab.snp': 'Notes' })).toBe('/n/b/k3f9x2ab.snp');
    expect(pageForLink('saturn-page:gone', { '/n/b/k3f9x2ab.snp': 'Notes' })).toBeUndefined();
  });
});

describe('tests tree', () => {
  it('expands groups to their leaf tests', () => {
    const tree = [{ id: 'file', label: 'f', children: [{ id: 'a', label: 'a' }, { id: 'g', label: 'g', children: [{ id: 'b', label: 'b' }] }] }, { id: 'c', label: 'c' }];
    expect(leaves(tree).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
});
