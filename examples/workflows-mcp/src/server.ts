import { Implementation } from "@modelcontextprotocol/sdk/types.js"
import { McpHonoServerDO } from "@nullshot/mcp"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { setupServerTools } from "./tools"
import { setupServerResources } from "./resources"
import { setupServerPrompts } from "./prompts"
import { WorkflowRepository } from "./repository"

/**
 * WorkflowsMcpServer extends McpHonoServerDO for workflow orchestration
 * Provides tools to create, monitor, and manage long-running workflows
 */
export class WorkflowsMcpServer extends McpHonoServerDO<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
	}

	getImplementation(): Implementation {
		return {
			name: "WorkflowsMcpServer",
			version: "1.0.0",
		}
	}

	configureServer(server: McpServer): void {
		const repository = new WorkflowRepository(this.ctx)

		this.ctx.blockConcurrencyWhile(async () => {
			repository.initializeDatabase()
		})

		setupServerTools(server, repository)
		setupServerResources(server, repository)
		setupServerPrompts(server)
	}
}
