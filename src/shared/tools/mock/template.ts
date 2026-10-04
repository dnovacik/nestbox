// Mock route bodies: {{params.name}} and {{query.name}} placeholders, nothing else. Shared so the renderer's
// editor validates a JSON body exactly as main renders it.

export type BodyType = 'json' | 'text';

const PLACEHOLDER = /\{\{\s*(params|query)\.([A-Za-z0-9_-]+)\s*\}\}/g;

export interface TemplateValues {
  params: Readonly<Record<string, string>>;
  query: Readonly<Record<string, string>>;
}

/** In a JSON body a value goes inside a string, so it is escaped like the inside of one. */
function escapeJsonString(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

export function renderBody(body: string, values: TemplateValues, type: BodyType): string {
  return body.replace(PLACEHOLDER, (_match, scope: 'params' | 'query', name: string) => {
    const value = values[scope][name] ?? '';
    return type === 'json' ? escapeJsonString(value) : value;
  });
}

/** null when the body is valid JSON once every placeholder is filled in (or empty); else the parse error. */
export function checkJsonBody(body: string): string | null {
  if (body.trim() === '') return null;
  try {
    JSON.parse(body.replace(PLACEHOLDER, '0'));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Not valid JSON';
  }
}
