/**
 * Schedule time utilities
 *
 * Parsing and formatting helpers used by schedule-handler.
 * The actual scheduled-post storage is handled by the Kanban system (kanban-storage.ts).
 */

/**
 * Format scheduled time for display
 */
export function formatScheduledTime(timestamp: number): string {
	const date = new Date(timestamp)
	const now = new Date()

	// Check if same day
	const isToday = date.toDateString() === now.toDateString()

	// Check if tomorrow
	const tomorrow = new Date(now)
	tomorrow.setDate(tomorrow.getDate() + 1)
	const isTomorrow = date.toDateString() === tomorrow.toDateString()

	const timeStr = date.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	})

	if (isToday) {
		return `Today at ${timeStr}`
	} else if (isTomorrow) {
		return `Tomorrow at ${timeStr}`
	} else {
		const dateStr = date.toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
		})
		return `${dateStr} at ${timeStr}`
	}
}

/**
 * Parse user input for scheduling time
 * Supports:
 * - "10m" / "10min" - in 10 minutes
 * - "2h" / "2hr" - in 2 hours
 * - "1d" / "1day" - in 1 day
 * - "15:30" - at 15:30 today (or tomorrow if passed)
 * - "tomorrow 10:00" - tomorrow at 10:00
 */
export function parseScheduleTime(input: string): Date | null {
	const now = new Date()
	const trimmed = input.trim().toLowerCase()

	// Relative time: "10m", "2h", "1d"
	const relativeMatch = trimmed.match(/^(\d+)\s*(m|min|minutes?|h|hr|hours?|d|days?)$/)
	if (relativeMatch) {
		const value = parseInt(relativeMatch[1])
		const unit = relativeMatch[2]

		if (unit.startsWith("m")) {
			return new Date(now.getTime() + value * 60 * 1000)
		} else if (unit.startsWith("h")) {
			return new Date(now.getTime() + value * 60 * 60 * 1000)
		} else if (unit.startsWith("d")) {
			return new Date(now.getTime() + value * 24 * 60 * 60 * 1000)
		}
	}

	// Time only: "15:30" or "3:30pm"
	const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/)
	if (timeMatch) {
		let hours = parseInt(timeMatch[1])
		const minutes = parseInt(timeMatch[2])
		const ampm = timeMatch[3]

		if (ampm === "pm" && hours < 12) hours += 12
		if (ampm === "am" && hours === 12) hours = 0

		const scheduled = new Date(now)
		scheduled.setHours(hours, minutes, 0, 0)

		// If time has passed today, schedule for tomorrow
		if (scheduled <= now) {
			scheduled.setDate(scheduled.getDate() + 1)
		}

		return scheduled
	}

	// Tomorrow with time: "tomorrow 10:00"
	const tomorrowMatch = trimmed.match(/^tomorrow\s+(\d{1,2}):(\d{2})\s*(am|pm)?$/)
	if (tomorrowMatch) {
		let hours = parseInt(tomorrowMatch[1])
		const minutes = parseInt(tomorrowMatch[2])
		const ampm = tomorrowMatch[3]

		if (ampm === "pm" && hours < 12) hours += 12
		if (ampm === "am" && hours === 12) hours = 0

		const scheduled = new Date(now)
		scheduled.setDate(scheduled.getDate() + 1)
		scheduled.setHours(hours, minutes, 0, 0)

		return scheduled
	}

	return null
}
