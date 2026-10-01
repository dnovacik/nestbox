import type { z } from 'zod';

export const ERROR_CODES = [
  'VALIDATION',
  'NOT_FOUND',
  'CONFLICT',
  'NOT_IMPLEMENTED',
  'FORBIDDEN',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class NestboxError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'NestboxError';
    this.code = code;
  }
}

export type IpcEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string } };

export function ok<T>(data: T): IpcEnvelope<T> {
  return { ok: true, data };
}

export function fail(code: ErrorCode, message: string): IpcEnvelope<never> {
  return { ok: false, error: { code, message } };
}

/** Path + issue code only. Never includes received values (they may be secrets). */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.code}`)
    .join(', ');
}
