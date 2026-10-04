import { describe, expect, it } from 'vitest';
import { classifyFailure } from './errors';

describe('classifyFailure', () => {
  it.each([
    'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
    'error during connect: Get "http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.47/containers/json": open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.',
    'request returned 500 Internal Server Error for API route and version http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.48/containers/json, check if the server supports the requested API version',
    'docker daemon is not running',
  ])('sees the daemon down in %#', (stderr) => {
    expect(classifyFailure(stderr)).toBe('daemon-down');
  });

  it('calls anything else a plain failure', () => {
    expect(classifyFailure('service "x" has neither an image nor a build context specified')).toBe(
      'failed',
    );
    expect(classifyFailure('')).toBe('failed');
  });
});
