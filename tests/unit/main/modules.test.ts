import { describe, expect, it } from 'vitest';
import { documentFor, SATURN_API_VERSION, satisfiesCaret } from '@shared/modules';

describe('extension documents', () => {
  it('matches a document type by file extension, ignoring case', () => {
    const snapshot = { documents: [{ id: 'diagrams.board', label: 'Board', extensions: ['.diagram'] }] };
    expect(documentFor(snapshot, '/a/b/Board.DIAGRAM')?.id).toBe('diagrams.board');
    expect(documentFor(snapshot, '/a/b.txt')).toBeUndefined();
  });

  it('accepts ^0.5 modules on 0.5 but not on 0.4', () => {
    expect(satisfiesCaret('^0.5', '0.5.0')).toBe(true);
    expect(satisfiesCaret('^0.5', '0.4.0')).toBe(false);
  });
});

describe('module API versions', () => {
  it('needs the same major version', () => {
    expect(satisfiesCaret('^1.0', '2.0.0')).toBe(false);
    expect(satisfiesCaret('^2.0', '1.9.0')).toBe(false);
  });

  it('runs older minors but not newer ones', () => {
    expect(satisfiesCaret('^0.2', '0.3.0')).toBe(true);
    expect(satisfiesCaret('^0.3', '0.3.0')).toBe(true);
    expect(satisfiesCaret('^0.4', '0.3.0')).toBe(false);
    expect(satisfiesCaret('^1.2', '1.5.1')).toBe(true);
  });

  it('ignores patch versions', () => {
    expect(satisfiesCaret('^0.3.9', '0.3.0')).toBe(true);
    expect(satisfiesCaret('^0.3.0', '0.3.9')).toBe(true);
  });

  it('rejects ranges it cannot read', () => {
    expect(satisfiesCaret('latest', '0.3.0')).toBe(false);
    expect(satisfiesCaret('>=0.2', '0.3.0')).toBe(false);
  });

  it('reads the API version from package.json', () => {
    expect(SATURN_API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
