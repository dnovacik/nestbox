import { describe, expect, it } from 'vitest';
import { makeDetected, makeSummary } from '@/test/fixtures';
import { filterProjects, findProjectNode } from './find-project';

const api = makeDetected({ id: 'p1::packages/api', relPath: 'packages/api', name: '@mono/api' });
const mono = makeSummary({ id: 'p1', name: 'mono', detected: makeDetected({ id: 'p1', name: 'mono', workspaces: [api] }) });
const shop = makeSummary({ id: 'p2', name: 'shop', detected: makeDetected({ id: 'p2', rootId: 'p2', name: 'shop' }) });

describe('findProjectNode', () => {
  it('finds roots and workspaces', () => {
    expect(findProjectNode([mono, shop], 'p2')).toMatchObject({ isWorkspace: false, detected: { name: 'shop' } });
    expect(findProjectNode([mono, shop], 'p1::packages/api')).toMatchObject({
      isWorkspace: true,
      summary: { id: 'p1' },
      detected: { name: '@mono/api' },
    });
    expect(findProjectNode([mono], 'nope')).toBeNull();
    expect(findProjectNode([mono], null)).toBeNull();
  });
});

describe('filterProjects', () => {
  it('matches root or workspace names case-insensitively', () => {
    expect(filterProjects([mono, shop], '')).toEqual([mono, shop]);
    expect(filterProjects([mono, shop], 'SHO')).toEqual([shop]);
    expect(filterProjects([mono, shop], 'api')).toEqual([mono]);
  });
});
