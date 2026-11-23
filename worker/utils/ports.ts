/** Porty czasu i identyfikatorów - w testach podmieniane na deterministyczne. */

export interface ClockPort {
  now(): number;
}
export interface IdProviderPort {
  uuid(): string;
  /** Losowe bajty, np. do numeru zamówienia. */
  bytes(n: number): Uint8Array;
}

export const SystemClock: ClockPort = { now: () => Date.now() };
export const CryptoIdProvider: IdProviderPort = {
  uuid: () => crypto.randomUUID(),
  bytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
};

export class Stopwatch {
  private readonly clock: ClockPort;
  private readonly start: number;
  constructor(clock: ClockPort) {
    this.clock = clock;
    this.start = clock.now();
  }
  stop(): { durationMs: number } {
    return { durationMs: this.clock.now() - this.start };
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
