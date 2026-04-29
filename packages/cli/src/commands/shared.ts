import chalk from "chalk";
import {
  AuthManager,
  DEFAULT_API_URL,
  normalizeApiUrl,
  type AuthCredentials,
} from "../auth/auth-manager.js";
import { NullshotApiClient } from "../api/nullshot-api-client.js";

export interface ResourceCommandOptions {
  roomId?: string;
  apiUrl?: string;
}

/**
 * Resolve credentials + room id for any resource command.
 * Mirrors the existing `requireCredentialsForApiUrl` helper in cli.ts but
 * additionally resolves a default room id by picking the user's most-recent
 * jam when --room-id was not supplied.
 */
export async function resolveResourceContext(opts: {
  apiUrl?: string;
  roomId?: string;
}): Promise<{
  client: NullshotApiClient;
  creds: AuthCredentials;
  roomId: string;
}> {
  const target = normalizeApiUrl(opts.apiUrl ?? DEFAULT_API_URL);
  const creds = AuthManager.getCredentials(target);
  if (!creds) {
    const hint =
      target === normalizeApiUrl(DEFAULT_API_URL)
        ? "`nullshot login`"
        : `\`nullshot login --api-url ${target}\``;
    console.error(chalk.red(`Not authenticated for ${target}. Run ${hint} first.`));
    process.exit(1);
  }

  const client = new NullshotApiClient({
    baseUrl: creds.baseUrl,
    sessionToken: creds.sessionToken,
  });

  let roomId = opts.roomId;
  if (!roomId) {
    // Default: first room from the most recent jam.
    try {
      const { jams } = await client.listJams();
      const firstJam = jams[0];
      const firstRoom = firstJam?.rooms[0];
      if (!firstRoom) {
        console.error(
          chalk.red(
            "No active jam found. Pass --room-id <id> or run `nullshot jam` first.",
          ),
        );
        process.exit(1);
      }
      roomId = firstRoom.id;
      console.log(
        chalk.dim(`Using room ${roomId} (${firstJam?.name ?? "unknown jam"})`),
      );
    } catch (error) {
      console.error(
        chalk.red(
          error instanceof Error
            ? `Could not auto-resolve room: ${error.message}`
            : "Could not auto-resolve room.",
        ),
      );
      process.exit(1);
    }
  }

  return { client, creds, roomId };
}

export function reportApiError(action: string, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red(`${action} failed: ${message}`));
  process.exit(1);
}
