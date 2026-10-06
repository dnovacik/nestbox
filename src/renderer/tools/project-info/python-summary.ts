import type { PythonFramework, PythonInfo } from '@shared/detected';

const FRAMEWORKS: Record<PythonFramework, string> = {
  django: 'Django',
  fastapi: 'FastAPI',
  flask: 'Flask',
  script: 'Python scripts',
};

/** "FastAPI · .venv", "Python · no virtualenv". */
export function pythonSummary(python: PythonInfo): string {
  const framework = python.framework === null ? 'Python' : FRAMEWORKS[python.framework];
  return `${framework} · ${python.venv ?? 'no virtualenv'}`;
}
