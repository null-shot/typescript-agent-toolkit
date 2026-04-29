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

export function deriveCodeboxHttpBaseUrl(apiUrl: string): string {
  let host: string;
  let protocol: string;
  try {
    const parsed = new URL(apiUrl);
    host = parsed.hostname;
    protocol = parsed.protocol;
  } catch {
    return "https://instant.nullshot.dev";
  }

  if (host === "localhost" || host === "127.0.0.1") {
    return `${protocol}//${host}:8888`;
  }

  const prMatch = host.match(
    /^platform-website-pr-(\d+)\.devaccounts-1password\.workers\.dev$/,
  );
  if (prMatch) {
    const pr = prMatch[1];
    return `https://playground-pr-${pr}.devaccounts-1password.workers.dev`;
  }

  if (host === "test.nullshot.ai" || /^dev-.*-test\.xavalabs\.com$/.test(host)) {
    return "https://test.xavalabs.com";
  }

  return "https://instant.nullshot.dev";
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
 *   nullshot.ai  (production)
 *     → wss://instant.nullshot.dev/code-ws/...
 *     → wss://jams.api.nullshot.ai/jams/.../ws
 *
 *   Everything else
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

  // Production (nullshot.ai): connect directly to worker services.
  // The /api/jam/ws-urls server endpoint returns the same URLs, but deriving
  // them here avoids an extra round-trip.
  if (host === 'nullshot.ai') {
    return {
      codeboxWsUrl: `wss://instant.nullshot.dev/code-ws/${encodedRoom}${baseQuery}`,
      jamWsUrl: `wss://jams.api.nullshot.ai/jams/${jamId}/ws?roomId=${roomId}&userId=${userId}&source=cli&userName=${encodedUser}`,
      mode: 'direct',
    };
  }

  // Unknown host — fall back to server-provided URLs via /api/jam/ws-urls
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

export interface CompilationLog {
  id: string;
  timestamp: number;
  status: 'success' | 'error';
  trigger: string;
  files_checked: number;
  duration_ms: number;
  error_count: number;
  diagnostics: string | null;
}

export interface Message {
  id: string;
  ownerType: 'user' | 'assistant';
  content: string;
  timestamp: number;
  messageType?: string;
  messageSubType?: string;
  status?: string;
}

export interface ErrorReport {
  success: boolean;
  message: string;
  typescript: {
    status: string;
    errors: Array<
      string | {
        file?: string;
        line?: number;
        column?: number;
        message?: string;
        code?: string;
      }
    >;
    filesChecked?: number;
    errorCount?: number;
    note?: string;
    failed_type_packages?: string[];
  };
  runtime: {
    status: string;
    errors: Array<{
      message?: string;
      source?: string;
      stack?: string;
      occurrences?: number;
      count?: number;
    }>;
    message?: string;
    errorCount?: number;
  };
  transpile: {
    status: string;
    errors: Array<
      string | {
        file?: string;
        line?: number;
        column?: number;
        message?: string;
        diagnostics?: string;
      }
    >;
    errorCount?: number;
  };
  worker_preflight?: {
    status: string;
    stage?: string;
    entryPoint?: string;
    errorCount?: number;
    errors?: string[];
    warnings?: string[];
  };
  worker_logs?: {
    status?: string;
    errors?: Array<{
      level?: string;
      message?: string;
      source?: string;
      timestamp?: string;
    }>;
    errorCount?: number;
    recent_logs?: Array<{
      level?: string;
      message?: string;
      source?: string;
      timestamp?: string;
    }>;
    hint?: string;
  };
  frontend_logs?: {
    errorCount?: number;
    warningCount?: number;
    errors?: Array<{
      message?: string;
      timestamp?: string;
    }>;
    warnings?: Array<{
      message?: string;
      timestamp?: string;
    }>;
    hint?: string;
  };
  bundle_warnings?: string[];
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

  async getLogs(roomId: string, branch: string = 'main'): Promise<CompilationLog[]> {
    if (!this.sessionToken) {
      throw new Error("Not authenticated. Run `nullshot login` first.");
    }

    const qs = new URLSearchParams({ roomId, branch });
    const response = await fetch(`${this.baseUrl}/api/jam/cli-logs?${qs}`, {
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
      throw new Error(body.error || `Failed to get logs (${response.status})`);
    }

    const data = await response.json() as CompilationLog[] | { logs?: CompilationLog[] };
    return Array.isArray(data) ? data : (data.logs ?? []);
  }

  private async resolveJamIdForRoom(roomId: string): Promise<string> {
    const { jams } = await this.listJams();

    for (const jam of jams) {
      if (jam.rooms.some((room) => room.id === roomId)) {
        return jam.id;
      }
    }

    // Fall back to the home-room convention when the room was not found.
    return roomId;
  }

  async getMessages(roomId: string, jamId?: string): Promise<Message[]> {
    if (!this.sessionToken) {
      throw new Error("Not authenticated. Run `nullshot login` first.");
    }

    const resolvedJamId = jamId || await this.resolveJamIdForRoom(roomId);
    const qs = new URLSearchParams({ roomId });
    if (resolvedJamId) {
      qs.set('jamId', resolvedJamId);
    }
    const response = await fetch(`${this.baseUrl}/api/jam/cli-messages?${qs}`, {
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
      throw new Error(body.error || `Failed to get messages (${response.status})`);
    }

    const data = await response.json() as Message[] | { messages?: Message[] };
    return Array.isArray(data) ? data : (data.messages ?? []);
  }

  async getRawMessages(roomId: string, jamId?: string): Promise<string> {
    if (!this.sessionToken) {
      throw new Error("Not authenticated. Run `nullshot login` first.");
    }

    const resolvedJamId = jamId || await this.resolveJamIdForRoom(roomId);
    const qs = new URLSearchParams({ roomId });
    if (resolvedJamId) {
      qs.set('jamId', resolvedJamId);
    }
    const response = await fetch(`${this.baseUrl}/api/jam/cli-messages-raw?${qs}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.sessionToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Session expired. Run `nullshot login` to re-authenticate.");
      }
      const body = await response.text().catch(() => "Unknown error");
      throw new Error(body || `Failed to get raw messages (${response.status})`);
    }

    return response.text();
  }

  async getErrors(roomId: string, branch: string = 'main'): Promise<ErrorReport> {
    if (!this.sessionToken) {
      throw new Error("Not authenticated. Run `nullshot login` first.");
    }

    const qs = new URLSearchParams({ roomId, branch });
    const response = await fetch(`${this.baseUrl}/api/jam/cli-errors?${qs}`, {
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
      throw new Error(body.error || `Failed to get error report (${response.status})`);
    }

    return (await response.json()) as ErrorReport;
  }

  getWebSocketUrl(path: string): string {
    const wsBase = this.baseUrl.replace(/^http/, "ws");
    return `${wsBase}${path}`;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Generic typed JSON helper for resource endpoints.
  // ────────────────────────────────────────────────────────────────────────
  private async request<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, string | number | undefined>;
      raw?: boolean;
    },
  ): Promise<T> {
    if (!this.sessionToken) {
      throw new Error("Not authenticated. Run `nullshot login` first.");
    }

    let url = `${this.baseUrl}${path}`;
    if (options?.query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(options.query)) {
        if (v === undefined) continue;
        qs.set(k, String(v));
      }
      const s = qs.toString();
      if (s) url += `?${s}`;
    }

    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.sessionToken}`,
        "Content-Type": "application/json",
      },
    };
    if (options?.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, init);
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Session expired. Run `nullshot login` to re-authenticate.");
      }
      const text = await response.text().catch(() => "");
      let msg: string | undefined;
      try {
        const parsed = JSON.parse(text) as { error?: string; message?: string };
        msg = parsed.error || parsed.message;
      } catch {
        msg = text || undefined;
      }
      throw new Error(msg || `${method} ${path} failed (${response.status})`);
    }

    if (options?.raw) {
      return response as unknown as T;
    }

    return (await response.json()) as T;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Secrets
  // ────────────────────────────────────────────────────────────────────────
  async putSecret(roomId: string, key: string, value: string): Promise<{ ok: true }> {
    return this.request<{ ok: true }>(
      "PUT",
      `/api/jam/cli/${encodeURIComponent(roomId)}/secrets/${encodeURIComponent(key)}`,
      { body: { value } },
    );
  }

  async listSecrets(roomId: string): Promise<{ keys: string[] }> {
    return this.request<{ keys: string[] }>(
      "GET",
      `/api/jam/cli/${encodeURIComponent(roomId)}/secrets`,
    );
  }

  async deleteSecret(roomId: string, key: string): Promise<{ ok: true }> {
    return this.request<{ ok: true }>(
      "DELETE",
      `/api/jam/cli/${encodeURIComponent(roomId)}/secrets/${encodeURIComponent(key)}`,
    );
  }

  async bulkPutSecrets(
    roomId: string,
    entries: Array<{ key: string; value: string }>,
  ): Promise<{ ok: true; count: number }> {
    return this.request<{ ok: true; count: number }>(
      "POST",
      `/api/jam/cli/${encodeURIComponent(roomId)}/secrets/bulk`,
      { body: { entries } },
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // Database
  // ────────────────────────────────────────────────────────────────────────
  async createDatabase(
    roomId: string,
    binding: string,
    databaseName: string,
  ): Promise<{ database_id: string }> {
    return this.request<{ database_id: string }>(
      "POST",
      `/api/jam/cli/${encodeURIComponent(roomId)}/database`,
      { body: { binding, database_name: databaseName } },
    );
  }

  async listDatabases(roomId: string): Promise<{
    databases: Array<{ binding: string; database_id: string; database_name: string }>;
  }> {
    return this.request(
      "GET",
      `/api/jam/cli/${encodeURIComponent(roomId)}/database`,
    );
  }

  async migrateDatabase(
    roomId: string,
    binding: string,
    migrations: Array<{ name: string; sql: string }>,
  ): Promise<{ applied: string[]; skipped: string[] }> {
    return this.request(
      "POST",
      `/api/jam/cli/${encodeURIComponent(roomId)}/database/${encodeURIComponent(binding)}/migrate`,
      { body: { migrations } },
    );
  }

  async queryDatabase(
    roomId: string,
    binding: string,
    sql: string,
    params?: unknown[],
  ): Promise<{
    results: unknown[];
    meta: { rowsRead: number; rowsWritten: number };
  }> {
    return this.request(
      "POST",
      `/api/jam/cli/${encodeURIComponent(roomId)}/database/${encodeURIComponent(binding)}/query`,
      { body: params ? { sql, params } : { sql } },
    );
  }

  async dumpDatabase(roomId: string, binding: string): Promise<Response> {
    return this.request<Response>(
      "GET",
      `/api/jam/cli/${encodeURIComponent(roomId)}/database/${encodeURIComponent(binding)}/dump`,
      { raw: true },
    );
  }

  async restoreDatabase(
    roomId: string,
    binding: string,
    sql: string,
  ): Promise<{ ok: true }> {
    return this.request<{ ok: true }>(
      "POST",
      `/api/jam/cli/${encodeURIComponent(roomId)}/database/${encodeURIComponent(binding)}/restore`,
      { body: { sql } },
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // Storage (R2)
  // ────────────────────────────────────────────────────────────────────────
  async signStoragePut(
    roomId: string,
    binding: string,
    key: string,
    contentType: string,
    contentLength: number,
  ): Promise<{ url: string; headers?: Record<string, string> }> {
    return this.request(
      "POST",
      `/api/jam/cli/${encodeURIComponent(roomId)}/storage/${encodeURIComponent(binding)}/sign-put`,
      { body: { key, contentType, contentLength } },
    );
  }

  async signStorageGet(
    roomId: string,
    binding: string,
    key: string,
  ): Promise<{ url: string }> {
    return this.request(
      "POST",
      `/api/jam/cli/${encodeURIComponent(roomId)}/storage/${encodeURIComponent(binding)}/sign-get`,
      { body: { key } },
    );
  }

  async listStorage(
    roomId: string,
    binding: string,
    options?: { prefix?: string; cursor?: string; limit?: number },
  ): Promise<{
    objects: Array<{ key: string; size: number; etag: string; uploaded: string }>;
    cursor?: string;
  }> {
    return this.request(
      "GET",
      `/api/jam/cli/${encodeURIComponent(roomId)}/storage/${encodeURIComponent(binding)}`,
      {
        query: {
          prefix: options?.prefix,
          cursor: options?.cursor,
          limit: options?.limit,
        },
      },
    );
  }

  async deleteStorage(
    roomId: string,
    binding: string,
    key: string,
  ): Promise<{ ok: true }> {
    return this.request<{ ok: true }>(
      "DELETE",
      `/api/jam/cli/${encodeURIComponent(roomId)}/storage/${encodeURIComponent(binding)}/${encodeURIComponent(key)}`,
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // KV
  // ────────────────────────────────────────────────────────────────────────
  async listKvKeys(
    roomId: string,
    binding: string,
    options?: { prefix?: string; cursor?: string; limit?: number },
  ): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
    cursor?: string;
  }> {
    return this.request(
      "GET",
      `/api/jam/cli/${encodeURIComponent(roomId)}/kv/${encodeURIComponent(binding)}`,
      {
        query: {
          prefix: options?.prefix,
          cursor: options?.cursor,
          limit: options?.limit,
        },
      },
    );
  }

  async getKvValue(
    roomId: string,
    binding: string,
    key: string,
  ): Promise<{ contentType: string; body: string }> {
    if (!this.sessionToken) {
      throw new Error("Not authenticated. Run `nullshot login` first.");
    }
    const url = `${this.baseUrl}/api/jam/cli/${encodeURIComponent(roomId)}/kv/${encodeURIComponent(binding)}/${encodeURIComponent(key)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.sessionToken}` },
    });
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Session expired. Run `nullshot login` to re-authenticate.");
      }
      const t = await response.text().catch(() => "");
      throw new Error(t || `Failed to fetch KV key (${response.status})`);
    }
    const contentType = response.headers.get("content-type") ?? "text/plain";
    const body = await response.text();
    return { contentType, body };
  }

  async putKvValue(
    roomId: string,
    binding: string,
    key: string,
    value: string,
    options?: {
      expiration?: number;
      expirationTtl?: number;
      metadata?: unknown;
    },
  ): Promise<{ ok: true }> {
    const body: Record<string, unknown> = { value };
    if (options?.expiration !== undefined) body.expiration = options.expiration;
    if (options?.expirationTtl !== undefined)
      body.expirationTtl = options.expirationTtl;
    if (options?.metadata !== undefined) body.metadata = options.metadata;

    return this.request<{ ok: true }>(
      "PUT",
      `/api/jam/cli/${encodeURIComponent(roomId)}/kv/${encodeURIComponent(binding)}/${encodeURIComponent(key)}`,
      { body },
    );
  }

  async deleteKvValue(
    roomId: string,
    binding: string,
    key: string,
  ): Promise<{ ok: true }> {
    return this.request<{ ok: true }>(
      "DELETE",
      `/api/jam/cli/${encodeURIComponent(roomId)}/kv/${encodeURIComponent(binding)}/${encodeURIComponent(key)}`,
    );
  }

  async bulkPutKv(
    roomId: string,
    binding: string,
    entries: Array<{
      key: string;
      value: string;
      expirationTtl?: number;
      metadata?: unknown;
    }>,
  ): Promise<{ count: number }> {
    return this.request<{ count: number }>(
      "POST",
      `/api/jam/cli/${encodeURIComponent(roomId)}/kv/${encodeURIComponent(binding)}/bulk`,
      { body: entries },
    );
  }
}
