import { EmailMcpServer } from "./server";

export { EmailMcpServer };

// Worker entrypoint for handling requests and email events.
// We shard by sessionId if provided, else by a stable name to avoid too many DOs.
export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Dynamically generate sessionId if it isn't provided to allocate a session
    const sessionId =
      request.headers.get("mcp-session-id") ?? crypto.randomUUID();

    const reqClone = request.clone();

    const json = await request.json();

    console.log("Request:", { headers: request.headers, json });

    const id = env.EMAIL_MCP_SERVER.idFromName(sessionId);

    return env.EMAIL_MCP_SERVER.get(id).fetch(
      new Request(url.toString(), reqClone),
    );
  },
};
