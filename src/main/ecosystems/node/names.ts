// Names that reach cmd.exe as task arguments (scripts, turbo tasks, Nx targets): one plain word.

/** A name that reaches cmd.exe as one plain word. */
export const PLAIN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/;
