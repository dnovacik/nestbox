import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTree, removeTree } from '../../detection/test-fixtures';
import { parseDatasource, readDatasource } from './schema';

let dir = '';
afterEach(async () => removeTree(dir));

describe('parseDatasource', () => {
  it('reads the provider and the env variable of the datasource', () => {
    const schema = `generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n`;
    expect(parseDatasource(schema)).toEqual({ provider: 'postgresql', env: 'DATABASE_URL', literal: false });
  });

  it('reads another variable name, and ignores commented-out lines', () => {
    const schema = `datasource main {\n  provider = "mysql"\n  // url = env("OLD_URL")\n  url = env( "APP_DB_URL" )\n  directUrl = env("DIRECT_URL")\n}`;
    expect(parseDatasource(schema)).toEqual({ provider: 'mysql', env: 'APP_DB_URL', literal: false });
  });

  it('flags a literal url without reading it', () => {
    const parsed = parseDatasource(`datasource db {\n  provider = "sqlite"\n  url = "file:./dev.db"\n}`);
    expect(parsed).toEqual({ provider: 'sqlite', env: null, literal: true });
  });

  it('has no url when Prisma 7 keeps it in prisma.config.ts', () => {
    expect(parseDatasource(`datasource db {\n  provider = "postgresql"\n}`)).toEqual({ provider: 'postgresql', env: null, literal: false });
  });

  it('returns null without a datasource block', () => {
    expect(parseDatasource('model User {\n  id Int @id\n}')).toBeNull();
  });
});

describe('readDatasource', () => {
  it('reads a single schema file', async () => {
    dir = await makeTree({ 'prisma/schema.prisma': 'datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}' });
    expect(await readDatasource(join(dir, 'prisma', 'schema.prisma'))).toMatchObject({ env: 'DATABASE_URL' });
  });

  it('finds the datasource among the files of a schema folder', async () => {
    dir = await makeTree({
      'prisma/schema/user.prisma': 'model User {\n id Int @id\n}',
      'prisma/schema/models/post.prisma': 'model Post {\n id Int @id\n}',
      'prisma/schema/main.prisma': 'datasource db {\n provider = "mysql"\n url = env("MY_URL")\n}',
    });
    expect(await readDatasource(join(dir, 'prisma', 'schema'))).toEqual({ provider: 'mysql', env: 'MY_URL', literal: false });
  });

  it('returns null for a missing schema', async () => {
    dir = await makeTree({ 'package.json': '{}' });
    expect(await readDatasource(join(dir, 'prisma', 'schema.prisma'))).toBeNull();
  });
});
