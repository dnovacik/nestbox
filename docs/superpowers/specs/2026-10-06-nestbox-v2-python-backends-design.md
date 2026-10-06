# NestBox v2: Python backends (1.21.0)

The owner's answers (2026-10-06):

- A project is often a React (or other Node) frontend plus a Python backend; both should start together.
- Commands: detected where possible, plus custom ones. The backend is often just `.py` files with no
  definition file.
- Environment: a local virtualenv on PATH; nothing else (no uv/poetry/pipenv runners in v1).
- Scope: detection, the Scripts tab and run groups. Python versions and Python dependency checks come later.

## Detection

`detection/python.ts`, pure filesystem like the rest of detection. `DetectedProject.python` is `PythonInfo | null`
(derived live, never stored, so the store stays at v2).

**Is it a Python package?** The folder has one of:

- a definition file: `pyproject.toml`, `requirements.txt`, `setup.py`, `setup.cfg`, `Pipfile`, `manage.py`;
- or any `.py` file directly in it (a backend is often just `.py` files).

A folder of helper scripts is not a backend: sub-folders named `scripts`, `tools`, `bin`, `docs` or `migrations`
(besides the existing `NOT_PACKAGES`) never count through `.py` files alone.

**Virtualenv.** The first of `.venv`, `venv`, `env` holding a `pyvenv.cfg`. Only the folder name is kept.

**Framework.** Read from (in order, first hit wins):

1. `manage.py` → Django;
2. the entry files (`main.py`, `app.py`, `server.py`, `api.py`, `asgi.py`, `wsgi.py`, `run.py`) in the folder and
   in `app/` (64 KiB cap each): a module-level `<var> = FastAPI(` → FastAPI, `<var> = Flask(` → Flask, keeping the
   module (`main`, `app.main`) and the variable name;
3. otherwise each top-level `.py` file (at most 20, entry files first) with `if __name__ == "__main__"` → a plain
   script.

File contents are only matched against these patterns; nothing else is kept, logged or sent.

**Detected commands** (`PythonInfo.commands`, `{ name, argv }`):

| Found | Commands |
| --- | --- |
| Django | `runserver` = `python manage.py runserver`, `migrate` = `python manage.py migrate` |
| FastAPI | `dev` = `python -m uvicorn <module>:<var> --reload` |
| Flask | `dev` = `python -m flask --app <module> run --debug` |
| Plain script | `<stem>` = `python <file>` |

`python -m …` uses the virtualenv's interpreter, so uvicorn and flask are found without their own PATH entry.
Module and variable names must match `^[A-Za-z_][A-Za-z0-9_.]*$` before they reach a command line.

## Packages

`findWorkspaceDirs` also returns Python package folders: definition files at `*/` and `*/*/`, `.py` files at `*/`
only (`backend/app/main.py` is a module of `backend`, not a package). A Python folder inside another found
package (Python or not) is dropped. Ignored: the existing `NOT_PACKAGES` list plus `venv`, `env`, `__pycache__`, `site-packages`.
They are added whether or not the root has a JS workspaces config, so `frontend/` (pnpm workspace) + `backend/`
both show up. The root itself can be a Python package (`pyproject.toml` at the root and a `frontend/` folder).

## Adding a project

`scan` and `addFolders` treat a folder as a package when it has a `package.json` **or** Python. A folder holding
`frontend/` and `backend/` therefore opens "Add under a group?". Its new first button, **Add as one project**,
adds the folder itself: its sub-folders become packages of one project, which is what a run group needs to start
the backend and the frontend together (run groups belong to a root project). The two existing choices stay.

## Commands in the Scripts tab

A package's runnable list is, in order: `package.json` scripts, detected Python commands, custom commands.
Names are unique per package: a detected command whose name is taken by a script is dropped; a custom command
can't take a used name (CONFLICT). `ScriptInfo.kind` is `npm | detected | custom`. Run groups, auto-restart, logs,
the tray and Ports keep working unchanged, because they already key on `(projectId, name)`.

**Custom commands** work for any package (not only Python): `toolSettings.scripts.commands`
(`{ relPath, name, argv }[]`, at most 100). The editor takes one line, split by `shared/command-line.ts`
(whitespace, `'…'` and `"…"` group). A command is a program and its arguments:

- no shell: pipes, `&&`, redirection and `$VAR` are passed literally (the same on Windows and macOS);
- a token can't hold `"`, CR, LF or NUL (they can't pass cmd.exe safely), at most 64 tokens of 1,000 characters;
- a leading `KEY=value` is refused ("Put it in .env"): settings never hold env values.

The command line is the user's own text: shown in the Scripts tab and as the log's first `▸` line, never logged
(the Logger gets the name).

## Running

`StartRequest` gains `command?: { program, args }` (default `<pm> run <script>`) and `env?: Record<string, string>`.
For a package with Python:

- the virtualenv's bin folder goes first on PATH (`pathPrepend`; `Scripts` on Windows, `bin` elsewhere, from
  the adapter's `venvBinDir`), and `VIRTUAL_ENV` is set to the virtualenv's path;
- `PYTHONUNBUFFERED=1` (otherwise output piped to NestBox arrives in 4 KiB blocks) and `PYTHONIOENCODING=utf-8`;
- without a virtualenv, a `python` program becomes the adapter's `pythonCommand` (`python` on Windows,
  `python3` on macOS, where `python` usually doesn't exist), and the log says
  `▲ No virtualenv (.venv) found: using python3 from PATH`.

The Node tool's start advice is asked only for `package.json` scripts.

## Renderer

- Scripts tab: rows show a `py` or `custom` chip next to the name. An **Add command** button opens a dialog
  (name, command line, a preview of the split arguments); custom rows get Edit and Delete.
- The empty state ("No scripts in package.json.") offers Add command.
- Project info shows `Python · FastAPI · .venv` (or "no virtualenv").

## Not in v1

uv/poetry/pipenv/pdm runners, `[tool.poe|pdm|taskipy]` tasks, `.python-version` checks, pip-audit.

## Tests

- **Unit:** marker and framework detection on fixture folders (FastAPI in `app/main.py`, Flask, Django,
  plain script, helper-scripts folder ignored, venv on both layouts), workspace discovery with a Python folder,
  the command-line splitter, the scripts tool's merged list and name rules, ProcessManager's custom command
  and env, the scan rule, the dialog's third button, the Add command dialog.
- **End to end:** a `frontend/` + `backend/` fixture, added as one project; a run group with `frontend dev`
  and the backend's detected `dev` starts both (`e2e/fixtures/fake-python` first on PATH).
