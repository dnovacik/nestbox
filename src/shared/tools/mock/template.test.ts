import { describe, expect, it } from 'vitest';
import { checkJsonBody, renderBody } from './template';

const values = { params: { id: '42' }, query: { q: 'a "quoted" \\ value' } };

describe('renderBody', () => {
  it('fills params and query, escaped inside JSON strings', () => {
    const out = renderBody('{"id":"{{params.id}}","q":"{{ query.q }}"}', values, 'json');
    expect(JSON.parse(out)).toEqual({ id: '42', q: 'a "quoted" \\ value' });
  });

  it('leaves text values as they are and makes missing values empty', () => {
    expect(renderBody('id={{params.id}} q={{query.q}} x={{params.nope}}', values, 'text')).toBe(
      'id=42 q=a "quoted" \\ value x=',
    );
  });

  it('ignores anything that is not a params or query placeholder', () => {
    expect(renderBody('{{env.SECRET}} {{params}}', values, 'text')).toBe(
      '{{env.SECRET}} {{params}}',
    );
  });
});

describe('checkJsonBody', () => {
  it('accepts JSON with placeholders in strings or as numbers, and an empty body', () => {
    expect(checkJsonBody('{"id":"{{params.id}}","n":{{query.n}}}')).toBeNull();
    expect(checkJsonBody('  ')).toBeNull();
  });

  it('reports invalid JSON', () => {
    expect(checkJsonBody('{"id":}')).toMatch(/JSON|token/i);
  });
});
