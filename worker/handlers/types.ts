import type { Env } from '../config/env.ts';
import type { Services } from '../services/init.ts';

export interface HandlerContext {
  request: Request;
  url: URL;
  env: Env;
  services: Services;
  /** Parametry ścieżki z routera, np. { id }. */
  params: Record<string, string>;
}

export type Handler = (ctx: HandlerContext) => Promise<Response>;
