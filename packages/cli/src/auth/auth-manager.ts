import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface AuthCredentials {
  sessionToken: string;
  userId: string;
  userName: string | null;
  email: string | null;
  expiresAt: number;
  baseUrl: string;
}

const AUTH_DIR = path.join(os.homedir(), ".nullshot");
const AUTH_FILE = path.join(AUTH_DIR, "auth.json");

export class AuthManager {
  static getCredentials(): AuthCredentials | null {
    try {
      if (!fs.existsSync(AUTH_FILE)) return null;
      const raw = fs.readFileSync(AUTH_FILE, "utf-8");
      const creds = JSON.parse(raw) as AuthCredentials;

      if (creds.expiresAt && creds.expiresAt < Date.now()) {
        return null;
      }

      return creds;
    } catch {
      return null;
    }
  }

  static saveCredentials(creds: AuthCredentials): void {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
    fs.writeFileSync(AUTH_FILE, JSON.stringify(creds, null, 2), "utf-8");
    fs.chmodSync(AUTH_FILE, 0o600);
  }

  static clearCredentials(): void {
    try {
      if (fs.existsSync(AUTH_FILE)) {
        fs.unlinkSync(AUTH_FILE);
      }
    } catch {
      // ignore
    }
  }

  static isAuthenticated(): boolean {
    return AuthManager.getCredentials() !== null;
  }

  static getAuthFilePath(): string {
    return AUTH_FILE;
  }
}
