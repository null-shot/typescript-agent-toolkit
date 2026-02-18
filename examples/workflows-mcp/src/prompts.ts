import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

export function setupServerPrompts(server: McpServer): void {
	server.prompt(
		"workflow_assistant",
		"Get guidance on creating and managing workflows",
		(args?: { task?: string }) => ({
			messages: [
				{
					role: "assistant" as const,
					content: {
						type: "text" as const,
						text: `I can help you create and manage workflows. ${args?.task ? `You want to: ${args.task}` : ""}

Here's what I can do:
- **create_workflow**: Define a multi-step workflow with automatic retries
- **start_workflow**: Begin executing a pending workflow  
- **get_workflow_status**: Check detailed progress of any workflow
- **advance_workflow_step**: Complete a step and move to the next
- **fail_workflow_step**: Report a failure (auto-retries if possible)
- **cancel_workflow**: Stop a running workflow
- **retry_workflow**: Restart a failed workflow from the failure point
- **list_workflows**: See all workflows with filtering

Example workflow creation:
\`\`\`
create_workflow({
  name: "Data Processing",
  description: "ETL pipeline for daily data",
  steps: [
    { name: "Extract Data", maxRetries: 3 },
    { name: "Transform Data", maxRetries: 2 },
    { name: "Load to Database", maxRetries: 5 }
  ],
  autoStart: true
})
\`\`\`

Each step runs sequentially. If a step fails, it retries automatically up to the configured limit.`,
					},
				},
			],
		})
	)

	server.prompt(
		"workflow_template_etl",
		"Template for an ETL (Extract-Transform-Load) workflow",
		() => ({
			messages: [
				{
					role: "assistant" as const,
					content: {
						type: "text" as const,
						text: `Here's an ETL workflow template:

Use create_workflow with these parameters:
- name: "ETL Pipeline"
- description: "Extract, transform, and load data"
- steps:
  1. "Fetch Source Data" (maxRetries: 3) - Connect to source and download
  2. "Validate Data" (maxRetries: 1) - Check data integrity  
  3. "Transform Data" (maxRetries: 2) - Apply transformations
  4. "Load to Destination" (maxRetries: 5) - Write to target database
  5. "Verify Load" (maxRetries: 2) - Confirm data was loaded correctly
- autoStart: true`,
					},
				},
			],
		})
	)

	server.prompt(
		"workflow_template_deployment",
		"Template for a deployment workflow",
		() => ({
			messages: [
				{
					role: "assistant" as const,
					content: {
						type: "text" as const,
						text: `Here's a deployment workflow template:

Use create_workflow with these parameters:
- name: "Deployment Pipeline"
- description: "Build, test, and deploy application"
- steps:
  1. "Run Tests" (maxRetries: 2) - Execute test suite
  2. "Build Application" (maxRetries: 3) - Compile and bundle
  3. "Deploy to Staging" (maxRetries: 3) - Push to staging environment
  4. "Run Smoke Tests" (maxRetries: 2) - Verify staging deployment
  5. "Deploy to Production" (maxRetries: 5) - Push to production
  6. "Health Check" (maxRetries: 3) - Verify production is healthy
- autoStart: false (start manually after review)`,
					},
				},
			],
		})
	)
}
