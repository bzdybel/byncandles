/** Porty czasu i identyfikatorów - w testach podmieniane na deterministyczne. */
import * as z from 'zod/mini';

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

/** UUID (RFC 9562) - identyfikatory zamówień i correlationId. */
export const uuidSchema = z.uuid();
export const isUuid = (v: unknown): v is string => z.safeParse(uuidSchema, v).success;
