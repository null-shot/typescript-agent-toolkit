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

export interface SkillInfo {
  name: string;
  /** Absolute URL to download SKILL.md from */
  path: string;
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
