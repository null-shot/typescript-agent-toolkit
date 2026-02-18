/**
 * Durable Object → Fetcher Adapter
 *
 * Creates a standard Fetcher that routes requests to a Durable Object
 * namespace, extracting the session ID from the URL path.
 *
 * Used by single-worker dashboard, cron processor, and telegram routes
 * to reach co-located AI agent DOs without an external URL or service binding.
 */

/**
 * Create a Fetcher adapter that routes to a single DurableObject namespace.
 * Session ID is extracted from the last path segment of the request URL.
 *
 * @param ns - The DurableObject namespace to route to
 * @returns A Fetcher-compatible object
 */
export function createDoAgentFetcher(ns: DurableObjectNamespace): Fetcher {
	return {
		fetch(
			input: Request | string | URL,
			init?: RequestInit,
		): Promise<Response> {
			const req =
				input instanceof Request
					? input
					: new Request(
							typeof input === "string" ? input : input.href,
							init,
						)
			const url = new URL(req.url)
			const pathParts = url.pathname.split("/")
			const sessionId = pathParts[pathParts.length - 1] || "default"
			const id = ns.idFromName(sessionId)
			return ns.get(id).fetch(req)
		},
		connect: undefined as never,
	} as Fetcher
}
