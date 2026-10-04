// What a failed docker command means. Only the class is kept: Docker's text can quote interpolated env values.

const DAEMON_DOWN =
  /Cannot connect to the Docker daemon|error during connect|docker daemon is not running|dockerDesktopLinuxEngine|dockerDesktopWindowsEngine/i;

export function classifyFailure(stderr: string): 'daemon-down' | 'failed' {
  return DAEMON_DOWN.test(stderr) ? 'daemon-down' : 'failed';
}
