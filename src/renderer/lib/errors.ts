import { NestboxError } from '@shared/errors';

export function errorMessage(error: unknown): string {
  return error instanceof NestboxError ? error.message : 'Something went wrong';
}
