import { type ChannelOutput, channels, type HandlerInput, type HandlerResult } from '@shared/channels';
import { describeIssues, type ErrorCode, fail, type IpcEnvelope, NestboxError, ok } from '@shared/errors';
import { type InvokeChannel, isInvokeChannel } from '@shared/ipc-names';
import type { Logger } from '../logger';

export type CoreHandlers = {
  [C in InvokeChannel]: (input: HandlerInput<C>) => Promise<HandlerResult<C>>;
};

export type Dispatch = (channel: string, senderUrl: string, payload: unknown) => Promise<IpcEnvelope<unknown>>;

export interface RouterDeps {
  handlers: CoreHandlers;
  isTrustedSender(url: string): boolean;
  logger: Logger;
  now?: () => number;
}

/** Upper bound on a payload's JSON length; checked before Zod parsing. */
export const MAX_PAYLOAD_CHARS = 2 * 1024 * 1024;

/** JSON length of the payload, or null when it cannot be serialised (cycles, BigInt). */
function payloadSize(payload: unknown): number | null {
  if (payload === undefined) return 0;
  try {
    return JSON.stringify(payload)?.length ?? 0;
  } catch {
    return null;
  }
}

export function createRouter(deps: RouterDeps): Dispatch {
  const now = deps.now ?? (() => performance.now());

  /** Fails closed: a sender check that throws counts as untrusted. */
  function trusted(url: string): boolean {
    try {
      return deps.isTrustedSender(url);
    } catch {
      return false;
    }
  }

  async function run<C extends InvokeChannel>(channel: C, payload: unknown): Promise<IpcEnvelope<ChannelOutput<C>>> {
    const spec = channels[channel];
    const input = spec.input.safeParse(payload);
    if (!input.success) {
      return fail('VALIDATION', `Invalid input for ${channel}: ${describeIssues(input.error)}`);
    }
    const handler = deps.handlers[channel] as (i: unknown) => Promise<unknown>;
    let result: unknown;
    try {
      result = await handler(input.data);
    } catch (error) {
      if (error instanceof NestboxError) return fail(error.code, error.message);
      deps.logger.error('ipc handler threw', { channel, error: error instanceof Error ? error.name : 'unknown' });
      return fail('INTERNAL', 'Unexpected error');
    }
    const output = spec.output.safeParse(result);
    if (!output.success) {
      deps.logger.error('ipc handler returned invalid output', { channel });
      return fail('INTERNAL', `${channel} returned invalid output`);
    }
    return ok(output.data as ChannelOutput<C>);
  }

  return async (channel, senderUrl, payload) => {
    const started = now();
    let envelope: IpcEnvelope<unknown>;
    const size = payloadSize(payload);
    if (!trusted(senderUrl)) {
      envelope = fail('FORBIDDEN', 'Untrusted sender');
    } else if (!isInvokeChannel(channel)) {
      envelope = fail('NOT_FOUND', 'Unknown channel');
    } else if (size === null) {
      envelope = fail('VALIDATION', 'Payload cannot be serialised');
    } else if (size > MAX_PAYLOAD_CHARS) {
      envelope = fail('VALIDATION', 'Payload too large');
    } else {
      envelope = await run(channel, payload);
    }
    const code: ErrorCode | 'OK' = envelope.ok ? 'OK' : envelope.error.code;
    deps.logger.info('ipc', { channel: isInvokeChannel(channel) ? channel : 'unknown', ms: Math.round(now() - started), code });
    return envelope;
  };
}
