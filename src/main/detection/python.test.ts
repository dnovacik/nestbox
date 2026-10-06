import { readdir } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { detectPython } from './python';
import { makeTree, removeTree } from './test-fixtures';

let dir = '';
afterEach(async () => removeTree(dir));

async function detect(entries: Record<string, string | null>) {
  dir = await makeTree(entries);
  const listed = await readdir(dir, { withFileTypes: true });
  const files = new Set(listed.filter((e) => e.isFile()).map((e) => e.name));
  const dirs = new Set(listed.filter((e) => e.isDirectory()).map((e) => e.name));
  return detectPython(dir, files, dirs);
}

const MAIN = 'if __name__ == "__main__":\n    main()\n';

describe('detectPython', () => {
  it('is null for a folder without Python files', async () => {
    expect(await detect({ 'package.json': '{}', 'README.md': '', 'src/x.py': '' })).toBeNull();
  });

  it('counts a definition file or any .py file at the top', async () => {
    expect(await detect({ 'requirements.txt': 'fastapi\n' })).toEqual({
      venv: null,
      framework: null,
      commands: [],
    });
    await removeTree(dir);
    expect(await detect({ 'helpers.py': 'x = 1\n' })).toEqual({
      venv: null,
      framework: null,
      commands: [],
    });
  });

  it('finds a FastAPI app in main.py', async () => {
    expect(await detect({ 'main.py': 'from fastapi import FastAPI\n\napp = FastAPI()\n' })).toEqual(
      {
        venv: null,
        framework: 'fastapi',
        commands: [{ name: 'dev', argv: ['python', '-m', 'uvicorn', 'main:app', '--reload'] }],
      },
    );
  });

  it('finds a FastAPI app in app/main.py under another name, annotated', async () => {
    const found = await detect({
      'requirements.txt': '',
      'app/__init__.py': '',
      'app/main.py': 'import fastapi\n\napi: fastapi.FastAPI = fastapi.FastAPI(title="Shop")\n',
    });
    expect(found?.commands).toEqual([
      { name: 'dev', argv: ['python', '-m', 'uvicorn', 'app.main:api', '--reload'] },
    ]);
  });

  it('ignores an app built inside a function', async () => {
    const found = await detect({
      'main.py': 'def create():\n    app = FastAPI()\n    return app\n',
    });
    expect(found).toEqual({ venv: null, framework: null, commands: [] });
  });

  it('finds a Flask app, naming the variable only when it is not app', async () => {
    expect(
      (await detect({ 'app.py': 'from flask import Flask\napp = Flask(__name__)\n' }))?.commands,
    ).toEqual([{ name: 'dev', argv: ['python', '-m', 'flask', '--app', 'app', 'run', '--debug'] }]);
    await removeTree(dir);
    const found = await detect({ 'server.py': 'import flask\nweb = flask.Flask(__name__)\n' });
    expect(found?.framework).toBe('flask');
    expect(found?.commands[0]?.argv).toEqual([
      'python',
      '-m',
      'flask',
      '--app',
      'server:web',
      'run',
      '--debug',
    ]);
  });

  it('takes manage.py as Django', async () => {
    expect(await detect({ 'manage.py': MAIN, 'main.py': 'app = FastAPI()\n' })).toEqual({
      venv: null,
      framework: 'django',
      commands: [
        { name: 'runserver', argv: ['python', 'manage.py', 'runserver'] },
        { name: 'migrate', argv: ['python', 'manage.py', 'migrate'] },
      ],
    });
  });

  it('offers each top-level script with a __main__ guard, entry files first', async () => {
    const found = await detect({
      'worker.py': MAIN,
      'util.py': 'def f():\n    pass\n',
      'run.py': "if __name__ == '__main__':\n    serve()\n",
      'bad name.py': MAIN,
    });
    expect(found).toEqual({
      venv: null,
      framework: 'script',
      commands: [
        { name: 'run', argv: ['python', 'run.py'] },
        { name: 'worker', argv: ['python', 'worker.py'] },
      ],
    });
  });

  it('looks for apps in entry files only', async () => {
    const found = await detect({ 'my-api.py': 'app = FastAPI()\n', 'main.py': 'x = 1\n' });
    expect(found).toEqual({ venv: null, framework: null, commands: [] });
  });

  it('finds a virtualenv by its pyvenv.cfg', async () => {
    expect((await detect({ 'main.py': '', '.venv/pyvenv.cfg': 'home = /usr/bin\n' }))?.venv).toBe(
      '.venv',
    );
    await removeTree(dir);
    expect((await detect({ 'main.py': '', 'venv/lib/x': '', 'env/pyvenv.cfg': '' }))?.venv).toBe(
      'env',
    );
  });
});
