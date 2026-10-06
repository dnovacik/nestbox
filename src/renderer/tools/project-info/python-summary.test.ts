import { describe, expect, it } from 'vitest';
import { pythonSummary } from './python-summary';

describe('pythonSummary', () => {
  it('names the framework and the virtualenv', () => {
    expect(pythonSummary({ venv: '.venv', framework: 'fastapi', commands: [] })).toBe(
      'FastAPI · .venv',
    );
    expect(pythonSummary({ venv: null, framework: 'django', commands: [] })).toBe(
      'Django · no virtualenv',
    );
    expect(pythonSummary({ venv: 'venv', framework: 'script', commands: [] })).toBe(
      'Python scripts · venv',
    );
    expect(pythonSummary({ venv: null, framework: null, commands: [] })).toBe(
      'Python · no virtualenv',
    );
  });
});
