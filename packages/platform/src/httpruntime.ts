/**
 * HTTP runtime adapter (architecture provider map: API/edge → Cloudflare
 * Workers → HttpRuntime).
 *
 * The application request handler is a WHATWG `fetch` signature
 * (`Request` → `Response`), which is the native shape of Workers and of
 * every major edge runtime — the portability boundary the frozen
 * architecture requires.
 */

/**
 * Application request handler. Runtimes hand it a standard `Request` and
 * expect a standard `Response`; bindings (env, execution context) are
 * runtime-owned and injected by the adapter, never by domain code.
 */
export interface HttpHandler {
  fetch(request: Request): Promise<Response>;
}

/** Options for serving an HTTP handler. */
export interface HttpServeOptions {
  readonly port?: number;
  readonly hostname?: string;
}

/**
 * Replacement interface for the API/edge concern.
 *
 * Provider default: Cloudflare Workers (cheap edge, global routing).
 */
export interface HttpRuntime {
  /** Registers the application handler with the runtime (idempotent). */
  serve(handler: HttpHandler, options?: HttpServeOptions): void;
}
