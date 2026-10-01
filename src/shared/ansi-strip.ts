// eslint-disable-next-line no-control-regex -- matching terminal escape sequences is the point
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

/** Removes ANSI escape sequences (SGR colours, cursor movement, OSC titles and links). */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}
