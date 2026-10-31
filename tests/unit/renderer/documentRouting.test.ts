import { describe, expect, it } from 'vitest';
import { shouldPostReload } from '@renderer/editor/DocumentView';

describe('extension document reloads', () => {
  it('tells the page only about changes it did not make itself', () => {
    expect(shouldPostReload('a', 'b', null)).toBe(true);
    expect(shouldPostReload('a', 'b', 'b')).toBe(false);
    expect(shouldPostReload('a', 'a', null)).toBe(false);
  });
});
