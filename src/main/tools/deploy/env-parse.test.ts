import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseFlySecrets,
  parseNetlifyEnv,
  parsePagesSecrets,
  parseVercelEnv,
  parseWorkersSecrets,
} from './env-parse';

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

describe('env key parsers', () => {
  it('keeps Vercel keys for the environment, once, and never a value', () => {
    const keys = parseVercelEnv(fixture('vercel-env.json'), 'production');
    expect(keys).toEqual(['DATABASE_URL', 'STRIPE_SECRET']);
    expect(parseVercelEnv(fixture('vercel-env.json'), 'preview')).toEqual(['STRIPE_SECRET']);
    expect(JSON.stringify(keys)).not.toContain('hunter2');
    expect(parseVercelEnv('{"error":"x"}', 'production')).toBeNull();
  });

  it('keeps Netlify keys and drops the values', () => {
    expect(parseNetlifyEnv(fixture('netlify-env.json'))).toEqual(['DATABASE_URL', 'NODE_VERSION']);
    expect(parseNetlifyEnv('{}')).toEqual([]);
    expect(parseNetlifyEnv('Not logged in')).toBeNull();
    expect(parseNetlifyEnv('[]')).toBeNull();
  });

  it('reads Workers, Pages and Fly secret names', () => {
    expect(parseWorkersSecrets(fixture('workers-secrets.json'))).toEqual([
      'API_KEY',
      'SESSION_SECRET',
    ]);
    expect(parsePagesSecrets(fixture('pages-secrets.txt'))).toEqual(['API_KEY', 'SESSION_SECRET']);
    expect(
      parsePagesSecrets('The "preview" environment … has access to the following secrets:\n'),
    ).toEqual([]);
    expect(parsePagesSecrets('✘ [ERROR] Not logged in')).toBeNull();
    expect(parseFlySecrets(fixture('fly-secrets.json'))).toEqual([
      'DATABASE_URL',
      'SECRET_KEY_BASE',
    ]);
    expect(parseFlySecrets('null')).toBeNull();
  });

  it('drops names that are not plain env keys', () => {
    expect(parseNetlifyEnv('{"OK_KEY":"1","bad key":"2","<script>":"3"}')).toEqual(['OK_KEY']);
  });
});
