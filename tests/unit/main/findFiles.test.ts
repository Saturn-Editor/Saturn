import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findFiles, globToRegExp } from '../../../src/main/Helpers/findFiles';

describe('globs', () => {
  it('matches stars, double stars and question marks', () => {
    expect(globToRegExp('**/*.md').test('docs/a/b.md')).toBe(true);
    expect(globToRegExp('**/*.md').test('b.md')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false);
    expect(globToRegExp('a?.js').test('ab.js')).toBe(true);
  });

  it('matches brace alternatives, including nested ones', () => {
    const re = globToRegExp('**/*.{test,spec}.{js,ts}');
    expect(re.test('src/math.test.js')).toBe(true);
    expect(re.test('math.spec.ts')).toBe(true);
    expect(re.test('math.js')).toBe(false);
    expect(globToRegExp('{a,b{c,d}}.txt').test('bd.txt')).toBe(true);
  });

  it("matches the JavaScript module's test patterns", () => {
    const suffix = globToRegExp('**/*{.,-,_}test.{js,mjs,cjs}');
    expect(suffix.test('src/math.test.js')).toBe(true);
    expect(suffix.test('math-test.mjs')).toBe(true);
    expect(suffix.test('a/b/math_test.cjs')).toBe(true);
    expect(suffix.test('mathtest.js')).toBe(false);
    const folder = globToRegExp('**/test/**/*.{js,mjs,cjs}');
    expect(folder.test('test/a.js')).toBe(true);
    expect(folder.test('pkg/test/unit/b.mjs')).toBe(true);
    expect(folder.test('tests/a.js')).toBe(false);
  });

  it('finds files and skips node_modules', async () => {
    const root = mkdtempSync(join(tmpdir(), 'saturn-glob-'));
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
    for (const f of ['src/a.test.js', 'src/b.spec.ts', 'src/c.js', 'node_modules/x/d.test.js']) writeFileSync(join(root, f), '');
    const found = (await findFiles(root, '**/*.{test,spec}.{js,ts}')).map((f) => relative(root, f).split('\\').join('/')).sort();
    expect(found).toEqual(['src/a.test.js', 'src/b.spec.ts']);
  });
});
