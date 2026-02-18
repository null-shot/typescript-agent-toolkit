/**
 * Workflow Repository
 * Uses Durable Object SQLite storage for persistent workflow state
 */

export interface Workflow {
	id: string
	name: string
	description: string
	status: "pending" | "running" | "completed" | "failed" | "cancelled"
	steps: WorkflowStep[]
	createdAt: string
	updatedAt: string
	completedAt?: string
	error?: string
	metadata?: Record<string, string>
}

export interface WorkflowStep {
	id: string
	name: string
	status: "pending" | "running" | "completed" | "failed" | "skipped"
	output?: string
	error?: string
	startedAt?: string
	completedAt?: string
	retryCount: number
	maxRetries: number
}

export class WorkflowRepository {
	private sql: DurableObjectState["storage"]["sql"]

	constructor(private ctx: DurableObjectState) {
		this.sql = ctx.storage.sql
	}

	initializeDatabase(): void {
		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS workflows (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				description TEXT DEFAULT '',
				status TEXT NOT NULL DEFAULT 'pending',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				completed_at TEXT,
				error TEXT,
				metadata TEXT DEFAULT '{}'
			)
		`)

		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS workflow_steps (
				id TEXT NOT NULL,
				workflow_id TEXT NOT NULL,
				name TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'pending',
				output TEXT,
				error TEXT,
				started_at TEXT,
				completed_at TEXT,
				retry_count INTEGER DEFAULT 0,
				max_retries INTEGER DEFAULT 3,
				step_order INTEGER NOT NULL,
				PRIMARY KEY (workflow_id, id),
				FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
			)
		`)
	}

	createWorkflow(
		name: string,
		description: string,
		steps: { name: string; maxRetries?: number }[],
		metadata?: Record<string, string>
	): Workflow {
		const id = crypto.randomUUID()
		const now = new Date().toISOString()

		this.sql.exec(
			`INSERT INTO workflows (id, name, description, status, created_at, updated_at, metadata)
			 VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
			id,
			name,
			description,
			now,
			now,
			JSON.stringify(metadata || {})
		)

		const workflowSteps: WorkflowStep[] = steps.map((step, index) => {
			const stepId = crypto.randomUUID()
			this.sql.exec(
				`INSERT INTO workflow_steps (id, workflow_id, name, status, retry_count, max_retries, step_order)
				 VALUES (?, ?, ?, 'pending', 0, ?, ?)`,
				stepId,
				id,
				step.name,
				step.maxRetries ?? 3,
				index
			)
			return {
				id: stepId,
				name: step.name,
				status: "pending" as const,
				retryCount: 0,
				maxRetries: step.maxRetries ?? 3,
			}
		})

		return {
			id,
			name,
			description,
			status: "pending",
			steps: workflowSteps,
			createdAt: now,
			updatedAt: now,
			metadata,
		}
	}

	getWorkflow(id: string): Workflow | null {
		const rows = [
			...this.sql.exec(`SELECT * FROM workflows WHERE id = ?`, id),
		]
		if (rows.length === 0) return null

		const row = rows[0] as Record<string, unknown>
		const stepRows = [
			...this.sql.exec(
				`SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order`,
				id
			),
		]

		const steps: WorkflowStep[] = stepRows.map((s) => {
			const sr = s as Record<string, unknown>
			return {
				id: sr.id as string,
				name: sr.name as string,
				status: sr.status as WorkflowStep["status"],
				output: sr.output as string | undefined,
				error: sr.error as string | undefined,
				startedAt: sr.started_at as string | undefined,
				completedAt: sr.completed_at as string | undefined,
				retryCount: sr.retry_count as number,
				maxRetries: sr.max_retries as number,
			}
		})

		return {
			id: row.id as string,
			name: row.name as string,
			description: row.description as string,
			status: row.status as Workflow["status"],
			steps,
			createdAt: row.created_at as string,
			updatedAt: row.updated_at as string,
			completedAt: row.completed_at as string | undefined,
			error: row.error as string | undefined,
			metadata: JSON.parse((row.metadata as string) || "{}"),
		}
	}

	listWorkflows(
		status?: string,
		limit = 50
	): Workflow[] {
		let rows: Iterable<unknown>
		if (status) {
			rows = this.sql.exec(
				`SELECT * FROM workflows WHERE status = ? ORDER BY updated_at DESC LIMIT ?`,
				status,
				limit
			)
		} else {
			rows = this.sql.exec(
				`SELECT * FROM workflows ORDER BY updated_at DESC LIMIT ?`,
				limit
			)
		}

		return [...rows].map((r) => {
			const row = r as Record<string, unknown>
			const id = row.id as string
			const stepRows = [
				...this.sql.exec(
					`SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order`,
					id
				),
			]

			const steps: WorkflowStep[] = stepRows.map((s) => {
				const sr = s as Record<string, unknown>
				return {
					id: sr.id as string,
					name: sr.name as string,
					status: sr.status as WorkflowStep["status"],
					output: sr.output as string | undefined,
					error: sr.error as string | undefined,
					startedAt: sr.started_at as string | undefined,
					completedAt: sr.completed_at as string | undefined,
					retryCount: sr.retry_count as number,
					maxRetries: sr.max_retries as number,
				}
			})

			return {
				id,
				name: row.name as string,
				description: row.description as string,
				status: row.status as Workflow["status"],
				steps,
				createdAt: row.created_at as string,
				updatedAt: row.updated_at as string,
				completedAt: row.completed_at as string | undefined,
				error: row.error as string | undefined,
				metadata: JSON.parse((row.metadata as string) || "{}"),
			}
		})
	}

	startWorkflow(id: string): boolean {
		const workflow = this.getWorkflow(id)
		if (!workflow || workflow.status !== "pending") return false

		const now = new Date().toISOString()
		this.sql.exec(
			`UPDATE workflows SET status = 'running', updated_at = ? WHERE id = ?`,
			now,
			id
		)

		// Start the first step
		if (workflow.steps.length > 0) {
			this.sql.exec(
				`UPDATE workflow_steps SET status = 'running', started_at = ? WHERE workflow_id = ? AND id = ?`,
				now,
				id,
				workflow.steps[0].id
			)
		}

		return true
	}

	advanceStep(workflowId: string, stepId: string, output: string): boolean {
		const workflow = this.getWorkflow(workflowId)
		if (!workflow || workflow.status !== "running") return false

		const now = new Date().toISOString()

		// Complete current step
		this.sql.exec(
			`UPDATE workflow_steps SET status = 'completed', output = ?, completed_at = ? WHERE workflow_id = ? AND id = ?`,
			output,
			now,
			workflowId,
			stepId
		)

		// Find next pending step
		const nextSteps = [
			...this.sql.exec(
				`SELECT id FROM workflow_steps WHERE workflow_id = ? AND status = 'pending' ORDER BY step_order LIMIT 1`,
				workflowId
			),
		]

		if (nextSteps.length > 0) {
			const nextStep = nextSteps[0] as Record<string, unknown>
			this.sql.exec(
				`UPDATE workflow_steps SET status = 'running', started_at = ? WHERE workflow_id = ? AND id = ?`,
				now,
				workflowId,
				nextStep.id as string
			)
		} else {
			// All steps completed
			this.sql.exec(
				`UPDATE workflows SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?`,
				now,
				now,
				workflowId
			)
		}

		this.sql.exec(
			`UPDATE workflows SET updated_at = ? WHERE id = ?`,
			now,
			workflowId
		)

		return true
	}

	failStep(
		workflowId: string,
		stepId: string,
		error: string
	): { retried: boolean } {
		const workflow = this.getWorkflow(workflowId)
		if (!workflow) return { retried: false }

		const step = workflow.steps.find((s) => s.id === stepId)
		if (!step) return { retried: false }

		const now = new Date().toISOString()

		if (step.retryCount < step.maxRetries) {
			// Retry
			this.sql.exec(
				`UPDATE workflow_steps SET retry_count = retry_count + 1, status = 'running', error = ?, started_at = ? WHERE workflow_id = ? AND id = ?`,
				error,
				now,
				workflowId,
				stepId
			)
			this.sql.exec(
				`UPDATE workflows SET updated_at = ? WHERE id = ?`,
				now,
				workflowId
			)
			return { retried: true }
		}

		// Max retries exceeded - fail
		this.sql.exec(
			`UPDATE workflow_steps SET status = 'failed', error = ?, completed_at = ? WHERE workflow_id = ? AND id = ?`,
			error,
			now,
			workflowId,
			stepId
		)
		this.sql.exec(
			`UPDATE workflows SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
			`Step "${step.name}" failed: ${error}`,
			now,
			workflowId
		)

		return { retried: false }
	}

	cancelWorkflow(id: string): boolean {
		const workflow = this.getWorkflow(id)
		if (
			!workflow ||
			workflow.status === "completed" ||
			workflow.status === "cancelled"
		) {
			return false
		}

		const now = new Date().toISOString()
		this.sql.exec(
			`UPDATE workflows SET status = 'cancelled', updated_at = ? WHERE id = ?`,
			now,
			id
		)

		// Skip all pending/running steps
		this.sql.exec(
			`UPDATE workflow_steps SET status = 'skipped' WHERE workflow_id = ? AND status IN ('pending', 'running')`,
			id
		)

		return true
	}

	retryWorkflow(id: string): boolean {
		const workflow = this.getWorkflow(id)
		if (!workflow || workflow.status !== "failed") return false

		const now = new Date().toISOString()

		// Reset the failed step and all subsequent steps
		this.sql.exec(
			`UPDATE workflow_steps SET status = 'pending', error = NULL, retry_count = 0, started_at = NULL, completed_at = NULL 
			 WHERE workflow_id = ? AND status IN ('failed', 'skipped')`,
			id
		)

		this.sql.exec(
			`UPDATE workflows SET status = 'running', error = NULL, updated_at = ? WHERE id = ?`,
			now,
			id
		)

		// Start the first pending step
		const nextSteps = [
			...this.sql.exec(
				`SELECT id FROM workflow_steps WHERE workflow_id = ? AND status = 'pending' ORDER BY step_order LIMIT 1`,
				id
			),
		]

		if (nextSteps.length > 0) {
			const nextStep = nextSteps[0] as Record<string, unknown>
			this.sql.exec(
				`UPDATE workflow_steps SET status = 'running', started_at = ? WHERE workflow_id = ? AND id = ?`,
				now,
				id,
				nextStep.id as string
			)
		}

		return true
	}

	getStats(): {
		total: number
		pending: number
		running: number
		completed: number
		failed: number
		cancelled: number
	} {
		const rows = [
			...this.sql.exec(
				`SELECT status, COUNT(*) as count FROM workflows GROUP BY status`
			),
		]

		const stats = {
			total: 0,
			pending: 0,
			running: 0,
			completed: 0,
			failed: 0,
			cancelled: 0,
		}

		for (const row of rows) {
			const r = row as Record<string, unknown>
			const status = r.status as string
			const count = r.count as number
			stats.total += count
			if (status in stats) {
				;(stats as Record<string, number>)[status] = count
			}
		}

		return stats
	}
}
