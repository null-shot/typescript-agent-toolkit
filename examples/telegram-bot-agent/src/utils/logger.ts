/**
 * Logger Utility
 * Structured logging with levels for Cloudflare Workers
 * 
 * In production: only warn/error
 * In development: all levels
 */

export type LogLevel = "debug" | "info" | "warn" | "error"

// Log level hierarchy
const LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
}

// Minimum log level — defaults to "info" (production-safe).
// Call setLogLevel() from your Worker's fetch handler to configure at runtime.
let currentMinLevel: LogLevel = "info"

/** Set the minimum log level (call once per request from env, e.g. env.LOG_LEVEL) */
export function setLogLevel(level: string | undefined): void {
	if (level && level in LEVELS) {
		currentMinLevel = level as LogLevel
	}
}

/**
 * Format log message with timestamp and level
 */
function formatMessage(level: LogLevel, message: string, data?: object): string {
	const prefix = getPrefix(level)
	
	if (data && Object.keys(data).length > 0) {
		return `${prefix} ${message} ${JSON.stringify(data)}`
	}
	return `${prefix} ${message}`
}

/**
 * Get emoji prefix for log level
 */
function getPrefix(level: LogLevel): string {
	switch (level) {
		case "debug": return "🔍"
		case "info": return "ℹ️"
		case "warn": return "⚠️"
		case "error": return "❌"
	}
}

/**
 * Check if log level is enabled
 */
function shouldLog(level: LogLevel): boolean {
	return LEVELS[level] >= LEVELS[currentMinLevel]
}

/**
 * Logger interface
 */
export const logger = {
	/**
	 * Debug level - verbose development info
	 * Hidden in production
	 */
	debug(message: string, data?: object): void {
		if (shouldLog("debug")) {
			console.log(formatMessage("debug", message, data))
		}
	},

	/**
	 * Info level - general operational info
	 */
	info(message: string, data?: object): void {
		if (shouldLog("info")) {
			console.log(formatMessage("info", message, data))
		}
	},

	/**
	 * Warn level - potential issues
	 */
	warn(message: string, data?: object): void {
		if (shouldLog("warn")) {
			console.warn(formatMessage("warn", message, data))
		}
	},

	/**
	 * Error level - actual errors
	 */
	error(message: string, error?: Error | unknown, data?: object): void {
		if (shouldLog("error")) {
			const errorData = error instanceof Error 
				? { error: error.message, stack: error.stack, ...data }
				: { error: String(error), ...data }
			console.error(formatMessage("error", message, errorData))
		}
	},

	/**
	 * Log with custom level
	 */
	log(level: LogLevel, message: string, data?: object): void {
		switch (level) {
			case "debug": this.debug(message, data); break
			case "info": this.info(message, data); break
			case "warn": this.warn(message, data); break
			case "error": this.error(message, undefined, data); break
		}
	},

	/**
	 * Create a child logger with prefix
	 */
	child(prefix: string) {
		return {
			debug: (msg: string, data?: object) => logger.debug(`[${prefix}] ${msg}`, data),
			info: (msg: string, data?: object) => logger.info(`[${prefix}] ${msg}`, data),
			warn: (msg: string, data?: object) => logger.warn(`[${prefix}] ${msg}`, data),
			error: (msg: string, err?: Error | unknown, data?: object) => logger.error(`[${prefix}] ${msg}`, err, data),
		}
	}
}

// Pre-configured child loggers for common modules
export const loggers = {
	bot: logger.child("Bot"),
	message: logger.child("Message"),
	agent: logger.child("Agent"),
	channel: logger.child("Channel"),
	schedule: logger.child("Schedule"),
	moderation: logger.child("Moderation"),
	proactive: logger.child("Proactive"),
	cron: logger.child("Cron"),
}
