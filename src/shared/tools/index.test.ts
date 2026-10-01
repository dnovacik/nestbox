import { describe, expect, it } from 'vitest';
import { toolContracts, toolDefinitions, toolEvents } from './index';

describe('shared tool registry', () => {
  it('has a contract for every definition', () => {
    expect(toolDefinitions.map((d) => d.id).sort()).toEqual(Object.keys(toolContracts).sort());
  });

  it('has an event map for every tool', () => {
    expect(Object.keys(toolEvents).sort()).toEqual(Object.keys(toolContracts).sort());
  });
});
