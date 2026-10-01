import { describe, expect, it } from 'vitest';
import { toolContracts, toolDefinitions } from './index';

describe('shared tool registry', () => {
  it('has a contract for every definition', () => {
    expect(toolDefinitions.map((d) => d.id).sort()).toEqual(Object.keys(toolContracts).sort());
  });
});
