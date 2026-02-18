import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WorkflowRepository } from "./repository"

export function setupServerResources(
	server: McpServer,
	repository: WorkflowRepository
): void {
	server.resource(
		"workflow",
		"workflow://workflows/{id}",
		async (uri: URL) => {
			try {
				const parts = uri.pathname.split("/")
				const id = parts[parts.length - 1]

				const workflow = repository.getWorkflow(id)

				if (!workflow) {
					return {
						contents: [
							{
								text: `Workflow ${id} not found`,
								uri: uri.href,
							},
						],
					}
				}

				return {
					contents: [
						{
							text: JSON.stringify(workflow, null, 2),
							uri: uri.href,
						},
					],
				}
			} catch (error) {
				throw new Error(
					`Failed to fetch workflow: ${error instanceof Error ? error.message : "Unknown error"}`
				)
			}
		}
	)

	server.resource(
		"workflow_stats",
		"workflow://stats",
		async (uri: URL) => {
			try {
				const stats = repository.getStats()

				return {
					contents: [
						{
							text: JSON.stringify(stats, null, 2),
							uri: uri.href,
						},
					],
				}
			} catch (error) {
				throw new Error(
					`Failed to fetch stats: ${error instanceof Error ? error.message : "Unknown error"}`
				)
			}
		}
	)
}
