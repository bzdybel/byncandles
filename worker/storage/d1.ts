/**
 * Minimalne typy D1 i wiązań Workers - zamiast @cloudflare/workers-types, które kolidują z typami DOM strony.
 * Testy podstawiają implementację na node:sqlite (tests/worker/helpers/d1.ts).
 */
export interface D1Result<T = unknown> {
  results: T[];
  meta: { changes: number };
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  /** Atomowo: błąd jednego zapytania wycofuje cały batch. */
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}
export interface Fetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}
export interface ScheduledController {
  cron: string;
  scheduledTime: number;
}
