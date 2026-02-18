import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { WorkflowRepository } from "./repository"

export function setupServerTools(
	server: McpServer,
	repository: WorkflowRepository
): void {
	server.tool(
		"create_workflow",
		"Create a new workflow with named steps. Each step runs sequentially with automatic retries on failure.",
		{
			name: z.string().describe("Workflow name (e.g., 'Data Processing Pipeline')"),
			description: z.string().optional().describe("What this workflow does"),
			steps: z
				.array(
					z.object({
						name: z.string().describe("Step name (e.g., 'Fetch Data', 'Transform', 'Save')"),
						maxRetries: z
							.number()
							.optional()
							.describe("Max retry attempts for this step (default: 3)"),
					})
				)
				.min(1)
				.describe("Ordered list of workflow steps"),
			metadata: z
				.record(z.string())
				.optional()
				.describe("Key-value metadata to attach to the workflow"),
			autoStart: z
				.boolean()
				.optional()
				.describe("Automatically start the workflow after creation (default: false)"),
		},
		async ({ name, description, steps, metadata, autoStart }) => {
			try {
				const workflow = repository.createWorkflow(
					name,
					description || "",
					steps,
					metadata
				)

				if (autoStart) {
					repository.startWorkflow(workflow.id)
					workflow.status = "running"
				}

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									success: true,
									workflow: {
										id: workflow.id,
										name: workflow.name,
										status: workflow.status,
										steps: workflow.steps.length,
										createdAt: workflow.createdAt,
									},
								},
								null,
								2
							),
						},
					],
				}
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error creating workflow: ${error instanceof Error ? error.message : "Unknown error"}`,
						},
					],
				}
			}
		}
	)

	server.tool(
		"get_workflow_status",
		"Get detailed status of a workflow including all step progress",
		{
			workflowId: z.string().describe("The workflow ID to check"),
		},
		async ({ workflowId }) => {
			const workflow = repository.getWorkflow(workflowId)

			if (!workflow) {
				return {
					content: [
						{
							type: "text",
							text: `Workflow ${workflowId} not found`,
						},
					],
				}
			}

			const completedSteps = workflow.steps.filter(
				(s) => s.status === "completed"
			).length
			const progress = Math.round(
				(completedSteps / workflow.steps.length) * 100
			)

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								id: workflow.id,
								name: workflow.name,
								description: workflow.description,
								status: workflow.status,
								progress: `${progress}%`,
								steps: workflow.steps.map((s) => ({
									name: s.name,
									status: s.status,
									retryCount: s.retryCount,
									maxRetries: s.maxRetries,
									...(s.output && { output: s.output }),
									...(s.error && { error: s.error }),
								})),
								createdAt: workflow.createdAt,
								updatedAt: workflow.updatedAt,
								...(workflow.completedAt && {
									completedAt: workflow.completedAt,
								}),
								...(workflow.error && { error: workflow.error }),
								...(workflow.metadata &&
									Object.keys(workflow.metadata).length > 0 && {
										metadata: workflow.metadata,
									}),
							},
							null,
							2
						),
					},
				],
			}
		}
	)

	server.tool(
		"list_workflows",
		"List all workflows, optionally filtered by status",
		{
			status: z
				.enum(["pending", "running", "completed", "failed", "cancelled"])
				.optional()
				.describe("Filter by workflow status"),
			limit: z
				.number()
				.optional()
				.describe("Maximum number of workflows to return (default: 50)"),
		},
		async ({ status, limit }) => {
			const workflows = repository.listWorkflows(status, limit)
			const stats = repository.getStats()

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								stats,
								workflows: workflows.map((w) => ({
									id: w.id,
									name: w.name,
									status: w.status,
									stepsCompleted: w.steps.filter(
										(s) => s.status === "completed"
									).length,
									stepsTotal: w.steps.length,
									createdAt: w.createdAt,
									updatedAt: w.updatedAt,
								})),
							},
							null,
							2
						),
					},
				],
			}
		}
	)

	server.tool(
		"start_workflow",
		"Start a pending workflow, beginning execution of its first step",
		{
			workflowId: z.string().describe("The workflow ID to start"),
		},
		async ({ workflowId }) => {
			const started = repository.startWorkflow(workflowId)

			if (!started) {
				return {
					content: [
						{
							type: "text",
							text: `Cannot start workflow ${workflowId}. It may not exist or is not in 'pending' status.`,
						},
					],
				}
			}

			const workflow = repository.getWorkflow(workflowId)

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								success: true,
								message: `Workflow "${workflow?.name}" started`,
								currentStep: workflow?.steps.find(
									(s) => s.status === "running"
								)?.name,
							},
							null,
							2
						),
					},
				],
			}
		}
	)

	server.tool(
		"advance_workflow_step",
		"Mark the current running step as completed and advance to the next step",
		{
			workflowId: z.string().describe("The workflow ID"),
			stepId: z.string().describe("The step ID to complete"),
			output: z
				.string()
				.optional()
				.describe("Output/result data from this step"),
		},
		async ({ workflowId, stepId, output }) => {
			const advanced = repository.advanceStep(
				workflowId,
				stepId,
				output || ""
			)

			if (!advanced) {
				return {
					content: [
						{
							type: "text",
							text: `Cannot advance step. Workflow may not be running.`,
						},
					],
				}
			}

			const workflow = repository.getWorkflow(workflowId)
			const nextStep = workflow?.steps.find(
				(s) => s.status === "running"
			)

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								success: true,
								workflowStatus: workflow?.status,
								...(nextStep && { nextStep: nextStep.name }),
								...(workflow?.status === "completed" && {
									message: "Workflow completed successfully!",
								}),
							},
							null,
							2
						),
					},
				],
			}
		}
	)

	server.tool(
		"fail_workflow_step",
		"Report a step failure. The step will be retried automatically if retries remain.",
		{
			workflowId: z.string().describe("The workflow ID"),
			stepId: z.string().describe("The step ID that failed"),
			error: z.string().describe("Error message describing the failure"),
		},
		async ({ workflowId, stepId, error }) => {
			const result = repository.failStep(workflowId, stepId, error)

			const workflow = repository.getWorkflow(workflowId)

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								retried: result.retried,
								workflowStatus: workflow?.status,
								message: result.retried
									? "Step will be retried automatically"
									: "Step failed permanently. Workflow marked as failed.",
							},
							null,
							2
						),
					},
				],
			}
		}
	)

	server.tool(
		"cancel_workflow",
		"Cancel a running or pending workflow. All incomplete steps will be skipped.",
		{
			workflowId: z.string().describe("The workflow ID to cancel"),
		},
		async ({ workflowId }) => {
			const cancelled = repository.cancelWorkflow(workflowId)

			return {
				content: [
					{
						type: "text",
						text: cancelled
							? `Workflow ${workflowId} has been cancelled.`
							: `Cannot cancel workflow ${workflowId}. It may already be completed or cancelled.`,
					},
				],
			}
		}
	)

	server.tool(
		"retry_workflow",
		"Retry a failed workflow from the failed step. Resets the failed step and all subsequent steps.",
		{
			workflowId: z.string().describe("The workflow ID to retry"),
		},
		async ({ workflowId }) => {
			const retried = repository.retryWorkflow(workflowId)

			if (!retried) {
				return {
					content: [
						{
							type: "text",
							text: `Cannot retry workflow ${workflowId}. It must be in 'failed' status.`,
						},
					],
				}
			}

			const workflow = repository.getWorkflow(workflowId)

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								success: true,
								message: `Workflow "${workflow?.name}" restarted from failed step`,
								currentStep: workflow?.steps.find(
									(s) => s.status === "running"
								)?.name,
							},
							null,
							2
						),
					},
				],
			}
		}
	)
}
