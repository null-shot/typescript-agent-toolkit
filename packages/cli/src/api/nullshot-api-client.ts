const DEFAULT_BASE_URL = "https://nullshot.ai";

export interface CliAuthResponse {
  sessionToken: string;
  userId: string;
  userName: string | null;
  userImage: string | null;
  email: string | null;
  expiresAt: number;
}

export interface JamRoomInfo {
  id: string;
  jamId: string;
  title: string;
  branchName: string;
  state: string | null;
  type: string | null;
  previewUrl: string;
  codeboxId: string | null;
}

export interface JamInfo {
  id: string;
  name: string;
  slug: string | null;
  type: string | null;
  rooms: JamRoomInfo[];
}

export interface ListJamsResponse {
  jams: JamInfo[];
}

export interface WsUrlsResponse {
  codeboxWsUrl: string;
  jamWsUrl: string;
  mode: 'direct' | 'proxy';
}

export interface WsUrlParams {
  roomId: string;
  jamId: string;
  userId: string;
  userName: string;
}

/**
 * Derive WebSocket URLs directly from the api-url without a server round-trip.
 *
 * The website worker cannot proxy WebSocket upgrades through OpenNext API routes,
 * so for any non-production host we construct direct worker URLs based on the
 * known URL patterns for each environment:
 *
 *   localhost / 127.0.0.1
 *     → ws://localhost:{8888,8790}/...
 *
 *   platform-website-pr-{N}.devaccounts-1password.workers.dev  (PR preview)
 *     → wss://playground-pr-{N}.devaccounts-1password.workers.dev/...
 *     → wss://jams-pr-{N}.devaccounts-1password.workers.dev/...
 *
 *   test.nullshot.ai or dev-*-test.xavalabs.com
 *     → wss://test.xavalabs.com/code-ws/...
 *     → wss://jams-test.api.nullshot.ai/jams/.../ws
 *
 *   Everything else (nullshot.ai, …)
 *     → null  (fall back to server-provided URLs via /api/jam/ws-urls)
 */
export function deriveWsUrls(apiUrl: string, params: WsUrlParams): WsUrlsResponse | null {
  const { roomId, jamId, userId, userName } = params;
  const encodedRoom = encodeURIComponent(roomId);
  const encodedUser = encodeURIComponent(userName);
  const baseQuery = `?source=cli&userId=${userId}&userName=${encodedUser}`;

  let host: string;
  try {
    host = new URL(apiUrl).hostname;
  } catch {
    return null;
  }

  // Local dev
  if (host === 'localhost' || host === '127.0.0.1') {
    return {
      codeboxWsUrl: `ws://localhost:8888/code-ws/${encodedRoom}${baseQuery}`,
      jamWsUrl: `ws://localhost:8790/jams/${jamId}/ws?roomId=${roomId}&userId=${userId}&source=cli&userName=${encodedUser}`,
      mode: 'direct',
    };
  }

  // PR preview: platform-website-pr-{N}.devaccounts-1password.workers.dev
  const prMatch = host.match(/^platform-website-pr-(\d+)\.devaccounts-1password\.workers\.dev$/);
  if (prMatch) {
    const pr = prMatch[1];
    return {
      codeboxWsUrl: `wss://playground-pr-${pr}.devaccounts-1password.workers.dev/code-ws/${encodedRoom}${baseQuery}`,
      jamWsUrl: `wss://jams-pr-${pr}.devaccounts-1password.workers.dev/jams/${jamId}/ws?roomId=${roomId}&userId=${userId}&source=cli&userName=${encodedUser}`,
      mode: 'direct',
    };
  }

  // Test environment: playground is at test.xavalabs.com, jams at jams-test.api.nullshot.ai
  if (host === 'test.nullshot.ai' || /^dev-.*-test\.xavalabs\.com$/.test(host)) {
    return {
      codeboxWsUrl: `wss://test.xavalabs.com/code-ws/${encodedRoom}${baseQuery}`,
      jamWsUrl: `wss://jams-test.api.nullshot.ai/jams/${jamId}/ws?roomId=${roomId}&userId=${userId}&source=cli&userName=${encodedUser}`,
      mode: 'direct',
    };
  }

  // Production — use server-provided URLs via /api/jam/ws-urls
  return null;
}

export interface SkillFile {
  /** Relative path within the skill folder (e.g. "SKILL.md", "references/limits.md") */
  relativePath: string;
  /** Full URL to fetch this file */
  url: string;
}

export interface SkillInfo {
  name: string;
  /** All files belonging to this skill, including subfolders */
  files: SkillFile[];
}

export interface SkillsResponse {
  skills: SkillInfo[];
  detected: string;
}

export class NullshotApiClient {
  private baseUrl: string;
  private sessionToken: string | null;

  constructor(options?: { baseUrl?: string | undefined; sessionToken?: string | undefined }) {
    this.baseUrl = (options?.baseUrl || process.env.NULLSHOT_API_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.sessionToken = options?.sessionToken || null;
  }

  setSessionToken(token: string): void {
    this.sessionToken = token;
  }

  async authenticateWithToken(cliToken: string): Promise<CliAuthResponse> {
    const response = await fetch(`${this.baseUrl}/api/jam/cli-auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: cliToken }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
      throw new Error(body.error || `Authentication failed (${response.status})`);
    }

    const data = (await response.json()) as CliAuthResponse;
    this.sessionToken = data.sessionToken;
    return data;
  }

  async listJams(): Promise<ListJamsResponse> {
    if (!this.sessionToken) {
      throw new Error("Not authenticated. Run `nullshot login` first.");
    }

    const response = await fetch(`${this.baseUrl}/api/jam/rooms`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.sessionToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Session expired. Run `nullshot login` to re-authenticate.");
      }
      const body = await response.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
      throw new Error(body.error || `Failed to fetch jams (${response.status})`);
    }

    return (await response.json()) as ListJamsResponse;
  }

  async getWsUrls(params: {
    roomId: string;
    jamId: string;
    userId: string;
    userName: string;
  }): Promise<WsUrlsResponse> {
    if (!this.sessionToken) {
      throw new Error("Not authenticated. Run `nullshot login` first.");
    }

    // Derive URLs directly from the api-url when the environment is known.
    // This avoids the website trying to proxy WebSocket upgrades, which
    // OpenNext cannot handle in Next.js API routes.
    const derived = deriveWsUrls(this.baseUrl, params);
    if (derived) return derived;

    const qs = new URLSearchParams({
      roomId: params.roomId,
      jamId: params.jamId,
      userId: params.userId,
      userName: params.userName,
    });

    const response = await fetch(`${this.baseUrl}/api/jam/ws-urls?${qs}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.sessionToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Session expired. Run `nullshot login` to re-authenticate.");
      }
      const body = await response.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
      throw new Error(body.error || `Failed to get WS URLs (${response.status})`);
    }

    return (await response.json()) as WsUrlsResponse;
  }

  async getSkills(params: {
    roomId: string;
    jamId: string;
    projectType?: string;
  }): Promise<SkillsResponse> {
    if (!this.sessionToken) {
      throw new Error("Not authenticated. Run `nullshot login` first.");
    }

    const qs = new URLSearchParams({
      roomId: params.roomId,
      jamId: params.jamId,
    });
    if (params.projectType) {
      qs.set('projectType', params.projectType);
    }

    const response = await fetch(`${this.baseUrl}/api/jam/skills?${qs}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.sessionToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Session expired. Run `nullshot login` to re-authenticate.");
      }
      const body = await response.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
      throw new Error(body.error || `Failed to get skills (${response.status})`);
    }

    return (await response.json()) as SkillsResponse;
  }

  getWebSocketUrl(path: string): string {
    const wsBase = this.baseUrl.replace(/^http/, "ws");
    return `${wsBase}${path}`;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
