import { describe, expect, it } from 'vitest';
import { matchLine } from './match';

const TAGS = ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG'];

describe('matchLine', () => {
  it.each([
    ['// TODO: wire the cache', { tag: 'TODO', text: 'wire the cache', owner: null }],
    ['  const x = 1; // FIXME handle null', { tag: 'FIXME', text: 'handle null', owner: null }],
    ['# todo: python style', { tag: 'TODO', text: 'python style', owner: null }],
    ['/* HACK(dan): until v2 */', { tag: 'HACK', text: 'until v2', owner: 'dan' }],
    [' * XXX this JSDoc line', { tag: 'XXX', text: 'this JSDoc line', owner: null }],
    ['<!-- TODO: fix the footer -->', { tag: 'TODO', text: 'fix the footer', owner: null }],
    ['-- BUG: off by one in the view', { tag: 'BUG', text: 'off by one in the view', owner: null }],
    ['; TODO ini comment', { tag: 'TODO', text: 'ini comment', owner: null }],
    ['{/* TODO: jsx */}', { tag: 'TODO', text: 'jsx', owner: null }],
    ['// TODO', { tag: 'TODO', text: '', owner: null }],
    ['//TODO(alice) no space', { tag: 'TODO', text: 'no space', owner: 'alice' }],
  ])('%j', (line, expected) => {
    expect(matchLine(line, TAGS)).toEqual(expected);
  });

  it.each([
    'const todoList = [];',
    'const label = "TODO: not a comment";',
    '// TODOS are plural',
    '// mastodon: TODOist is a word',
    'function hackish() {}',
    'url = "https://example.com/#TODO"',
    '',
  ])('ignores %j', (line) => {
    expect(matchLine(line, TAGS)).toBeNull();
  });

  it('only finds the configured tags', () => {
    expect(matchLine('// NOTE: later', TAGS)).toBeNull();
    expect(matchLine('// NOTE: later', ['NOTE'])).toEqual({ tag: 'NOTE', text: 'later', owner: null });
  });

  it('caps the text at 300 characters', () => {
    expect(matchLine(`// TODO: ${'x'.repeat(500)}`, TAGS)?.text).toHaveLength(300);
  });
});
