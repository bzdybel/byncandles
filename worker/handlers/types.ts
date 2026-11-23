import type { Env } from '../config/env.ts';
import type { Services } from '../services/init.ts';
import type { Defer } from '../utils/ports.ts';

export interface HandlerContext {
  request: Request;
  url: URL;
  env: Env;
  services: Services;
  /** Parametry ścieżki z routera, np. { id }. */
  params: Record<string, string>;
  /** Praca po wysłaniu odpowiedzi (ExecutionContext.waitUntil) - klient nie czeka na jej koniec. */
  defer: Defer;
}

export type Handler = (ctx: HandlerContext) => Promise<Response>;
