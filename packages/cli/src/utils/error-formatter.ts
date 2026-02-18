import chalk from "chalk";

export interface ErrorInfo {
  title: string;
  message: string;
  hint?: string;
  link?: string;
  code?: string;
}

/**
 * Parse wrangler/cloudflare errors into structured format
 */
export function parseCloudflareError(rawError: string): ErrorInfo {
  // Queues paid plan error
  if (rawError.includes("free plan") || rawError.includes("Paid plan")) {
    const match = rawError.match(
      /dash\.cloudflare\.com\/([^/]+)\/workers\/plans/,
    );
    const accountUrl = match
      ? `https://dash.cloudflare.com/${match[1]}/workers/plans`
      : "https://dash.cloudflare.com/workers/plans";

    return {
      title: "Paid Plan Required",
      message: "Cloudflare Queues requires Workers Paid plan",
      hint: "Upgrade your plan or skip queues-agent",
      link: accountUrl,
      code: "100129",
    };
  }

  // Queue doesn't exist
  if (rawError.includes("does not exist") && rawError.includes("Queue")) {
    const queueMatch = rawError.match(/Queue "([^"]+)"/);
    const queueName = queueMatch ? queueMatch[1] : "unknown";

    return {
      title: "Queue Not Found",
      message: `Queue "${queueName}" doesn't exist`,
      hint: `Create it first: npx wrangler queues create ${queueName}`,
      code: "QUEUE_NOT_FOUND",
    };
  }

  // Service binding not found
  if (rawError.includes("Could not resolve service binding")) {
    const serviceMatch = rawError.match(/service binding '([^']+)'/);
    const serviceName = serviceMatch ? serviceMatch[1] : "unknown";

    return {
      title: "Service Binding Error",
      message: `Service "${serviceName}" not found`,
      hint: "Deploy the required MCP server first",
      code: "SERVICE_NOT_FOUND",
    };
  }

  // Module not found
  if (rawError.includes("Could not resolve")) {
    const moduleMatch = rawError.match(/Could not resolve "([^"]+)"/);
    const moduleName = moduleMatch ? moduleMatch[1] : "unknown";

    return {
      title: "Missing Dependency",
      message: `Module "${moduleName}" not found`,
      hint: "Run: pnpm install",
      code: "MODULE_NOT_FOUND",
    };
  }

  // Authentication error
  if (
    rawError.includes("Not logged in") ||
    rawError.includes("Authentication")
  ) {
    return {
      title: "Authentication Required",
      message: "Not logged in to Cloudflare",
      hint: "Run: npx wrangler login",
      code: "AUTH_REQUIRED",
    };
  }

  // Generic error — include full message, not just the first line.
  // Cloudflare API errors typically span multiple lines with the detailed
  // reason on subsequent lines.
  const lines = rawError
    .split("\n")
    .map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim()) // strip ANSI codes
    .filter(
      (l) =>
        l && !l.startsWith("If you think this is a bug") && !l.startsWith("🪵"),
    );
  const cleanedMessage = lines
    .map((l) => l.replace(/✘ \[ERROR\]/, "").trim())
    .filter(Boolean)
    .join(" ");
  return {
    title: "Deployment Error",
    message: cleanedMessage || "Unknown error",
    code: "UNKNOWN",
  };
}

/**
 * Format error as a nice styled card
 */
export function formatErrorCard(error: ErrorInfo, _component: string): string {
  const lines: string[] = [];

  // Top border
  lines.push(chalk.red(`┌${"─".repeat(48)}┐`));
  lines.push(
    chalk.red(`│`) +
      chalk.red.bold(` ✖ ${error.title}`.padEnd(48)) +
      chalk.red(`│`),
  );
  lines.push(chalk.red(`├${"─".repeat(48)}┤`));

  // Message
  const msgLines = wrapText(error.message, 46);
  for (const line of msgLines) {
    lines.push(
      chalk.red(`│`) + chalk.white(` ${line}`.padEnd(48)) + chalk.red(`│`),
    );
  }

  // Hint (if present)
  if (error.hint) {
    lines.push(chalk.red(`│`) + " ".repeat(48) + chalk.red(`│`));
    lines.push(
      chalk.red(`│`) +
        chalk.cyan(` 💡 ${error.hint}`.padEnd(48)) +
        chalk.red(`│`),
    );
  }

  // Link (if present)
  if (error.link) {
    lines.push(
      chalk.red(`│`) +
        chalk.gray(` 🔗 ${error.link}`.substring(0, 48).padEnd(48)) +
        chalk.red(`│`),
    );
  }

  // Bottom border
  lines.push(chalk.red(`└${"─".repeat(48)}┘`));

  return lines.join("\n");
}

/**
 * Format error in compact inline style
 */
export function formatErrorInline(error: ErrorInfo, component: string): string {
  const lines: string[] = [];

  lines.push(chalk.red(`   ✖ ${component}: `) + chalk.red.bold(error.title));
  lines.push(chalk.gray(`     └─ ${error.message}`));

  if (error.hint) {
    lines.push(chalk.cyan(`     💡 ${error.hint}`));
  }

  if (error.link) {
    lines.push(chalk.gray(`     🔗 ${truncateUrl(error.link, 50)}`));
  }

  return lines.join("\n");
}

/**
 * Format warning (not an error, but important info)
 */
export function formatWarningCard(
  title: string,
  message: string,
  hint?: string,
): string {
  const lines: string[] = [];

  lines.push(chalk.yellow(`┌${"─".repeat(48)}┐`));
  lines.push(
    chalk.yellow(`│`) +
      chalk.yellow.bold(` ⚠ ${title}`.padEnd(48)) +
      chalk.yellow(`│`),
  );
  lines.push(chalk.yellow(`├${"─".repeat(48)}┤`));

  const msgLines = wrapText(message, 46);
  for (const line of msgLines) {
    lines.push(
      chalk.yellow(`│`) +
        chalk.white(` ${line}`.padEnd(48)) +
        chalk.yellow(`│`),
    );
  }

  if (hint) {
    lines.push(chalk.yellow(`│`) + " ".repeat(48) + chalk.yellow(`│`));
    lines.push(
      chalk.yellow(`│`) +
        chalk.cyan(` 💡 ${hint}`.padEnd(48)) +
        chalk.yellow(`│`),
    );
  }

  lines.push(chalk.yellow(`└${"─".repeat(48)}┘`));

  return lines.join("\n");
}

/**
 * Wrap text to specified width
 */
function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if ((currentLine + " " + word).trim().length <= maxWidth) {
      currentLine = (currentLine + " " + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine =
        word.length > maxWidth ? word.substring(0, maxWidth - 3) + "..." : word;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines.length ? lines : [""];
}

/**
 * Truncate URL for display
 */
function truncateUrl(url: string, maxLength: number): string {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength - 3) + "...";
}
