import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  AuthManager,
  DEFAULT_API_URL,
  normalizeApiUrl,
  type AuthCredentials,
} from "./auth-manager.js";

function sampleCreds(overrides: Partial<AuthCredentials> = {}): AuthCredentials {
  return {
    sessionToken: "tok",
    userId: "u1",
    userName: "User",
    email: "a@b.com",
    expiresAt: Date.now() + 86400_000,
    baseUrl: DEFAULT_API_URL,
    ...overrides,
  };
}

describe("normalizeApiUrl", () => {
  it("strips trailing slashes and matches DEFAULT", () => {
    expect(normalizeApiUrl("https://nullshot.ai/")).toBe(DEFAULT_API_URL);
    expect(normalizeApiUrl("https://nullshot.ai")).toBe(DEFAULT_API_URL);
  });

  it("preserves non-default hosts", () => {
    expect(normalizeApiUrl("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
  });
});

describe("AuthManager", () => {
  let authFile: string;

  beforeEach(() => {
    authFile = path.join(os.tmpdir(), `nullshot-auth-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    process.env.NULLSHOT_AUTH_FILE = authFile;
  });

  afterEach(() => {
    delete process.env.NULLSHOT_AUTH_FILE;
    try {
      fs.unlinkSync(authFile);
    } catch {
      // ignore
    }
  });

  it("migrates legacy v1 file to per-URL access", () => {
    const legacy = {
      sessionToken: "legacy",
      userId: "u",
      userName: null,
      email: null,
      expiresAt: Date.now() + 86400_000,
      baseUrl: "https://test.example/",
    };
    fs.mkdirSync(path.dirname(authFile), { recursive: true });
    fs.writeFileSync(authFile, JSON.stringify(legacy), "utf-8");

    const key = normalizeApiUrl("https://test.example");
    const creds = AuthManager.getCredentials(key);
    expect(creds?.sessionToken).toBe("legacy");
    expect(creds?.baseUrl).toBe(key);

    AuthManager.saveCredentials(sampleCreds({ baseUrl: DEFAULT_API_URL, sessionToken: "prod" }));
    expect(AuthManager.getAllCredentials()).toHaveLength(2);
  });

  it("keeps two environments separate", () => {
    AuthManager.saveCredentials(sampleCreds({ baseUrl: DEFAULT_API_URL, sessionToken: "a" }));
    AuthManager.saveCredentials(
      sampleCreds({ baseUrl: "http://localhost:3000", sessionToken: "b", userId: "u2" }),
    );

    expect(AuthManager.getCredentials(DEFAULT_API_URL)?.sessionToken).toBe("a");
    expect(AuthManager.getCredentials("http://localhost:3000")?.sessionToken).toBe("b");
  });

  it("dedupes keys that differ only by trailing slash", () => {
    AuthManager.saveCredentials(sampleCreds({ baseUrl: "https://foo.dev/", sessionToken: "one" }));
    AuthManager.saveCredentials(sampleCreds({ baseUrl: "https://foo.dev", sessionToken: "two" }));

    expect(AuthManager.getAllCredentials()).toHaveLength(1);
    expect(AuthManager.getCredentials("https://foo.dev")?.sessionToken).toBe("two");
  });

  it("drops only expired entries for one URL", () => {
    AuthManager.saveCredentials(sampleCreds({ baseUrl: DEFAULT_API_URL, sessionToken: "ok" }));
    AuthManager.saveCredentials(
      sampleCreds({
        baseUrl: "http://old.local",
        sessionToken: "bad",
        expiresAt: Date.now() - 1000,
      }),
    );

    expect(AuthManager.getCredentials("http://old.local")).toBeNull();
    expect(AuthManager.getCredentials(DEFAULT_API_URL)?.sessionToken).toBe("ok");
  });

  it("clearCredentials removes entire file when clearing all", () => {
    AuthManager.saveCredentials(sampleCreds());
    AuthManager.clearCredentials();
    expect(fs.existsSync(authFile)).toBe(false);
  });

  it("clearCredentials(apiUrl) removes one environment only", () => {
    AuthManager.saveCredentials(sampleCreds({ baseUrl: DEFAULT_API_URL }));
    AuthManager.saveCredentials(sampleCreds({ baseUrl: "http://x.local", userId: "x" }));

    AuthManager.clearCredentials("http://x.local");
    expect(AuthManager.getCredentials("http://x.local")).toBeNull();
    expect(AuthManager.getCredentials(DEFAULT_API_URL)).not.toBeNull();
  });

  it("clearCredentials for missing URL does not wipe other logins", () => {
    AuthManager.saveCredentials(sampleCreds());
    AuthManager.clearCredentials("http://missing.local");
    expect(AuthManager.getCredentials(DEFAULT_API_URL)).not.toBeNull();
  });
});
