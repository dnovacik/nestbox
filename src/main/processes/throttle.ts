export interface Throttled {
  (): void;
  cancel(): void;
}

/**
 * Calls `fn` at most once per `ms`: immediately on the first call, then once more at the end of the
 * window if it was called again meanwhile, so the last change is never lost.
 */
export function throttle(fn: () => void, ms: number): Throttled {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;

  const open = (): void => {
    timer = setTimeout(() => {
      timer = undefined;
      if (pending) {
        pending = false;
        fn();
        open();
      }
    }, ms);
  };

  const throttled = (() => {
    if (timer !== undefined) {
      pending = true;
      return;
    }
    fn();
    open();
  }) as Throttled;
  throttled.cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    pending = false;
  };
  return throttled;
}
