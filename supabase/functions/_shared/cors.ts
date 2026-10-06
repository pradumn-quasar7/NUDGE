import { corsHeaders } from "./deps.ts";

export { corsHeaders };

/** Error with an HTTP status. `code` is safe to return to clients and to log. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/** Answers CORS preflight requests; returns null for everything else. */
export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return null;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...headers },
  });
}

/**
 * Converts any thrown value into a JSON error response.
 * Logs only the function name, status and error code — never request or message bodies.
 */
export function errorResponse(fn: string, err: unknown): Response {
  if (err instanceof HttpError) {
    if (err.status >= 500) console.error(`[${fn}] ${err.status} ${err.code}`);
    return json({ error: err.code, message: err.message }, err.status);
  }
  console.error(`[${fn}] 500 unhandled ${err instanceof Error ? err.name : typeof err}`);
  return json({ error: "internal_error" }, 500);
}
