import { WorkflowsMcpServer } from "./server"

// Export the WorkflowsMcpServer class for Durable Object binding
export { WorkflowsMcpServer }

// Worker entrypoint for handling incoming requests
export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext
	): Promise<Response> {
		const url = new URL(request.url)
		const sessionIdStr = url.searchParams.get("sessionId")
		const id = sessionIdStr
			? env.WORKFLOWS_MCP_SERVER.idFromString(sessionIdStr)
			: env.WORKFLOWS_MCP_SERVER.newUniqueId()

		url.searchParams.set("sessionId", id.toString())

		return env.WORKFLOWS_MCP_SERVER.get(id).fetch(
			new Request(url.toString(), request)
		)
	},
}
