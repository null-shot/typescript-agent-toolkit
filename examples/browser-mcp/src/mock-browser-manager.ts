import { BrowserSession, NavigationOptions } from "./schema.js";

// Mock browser manager for testing when Browser Rendering isn't available
export class MockBrowserManager {
  private sessions: Map<string, any> = new Map();
  private sessionMetadata: Map<string, BrowserSession> = new Map();
  private env: Env;
  
  constructor(env: Env) {
    this.env = env;
  }

  async createSession(sessionId: string, options: NavigationOptions): Promise<any> {
    let currentUrl = options.url;

    const mockKeyboard = {
      press: (_key: string) => Promise.resolve(),
      type: (_text: string) => Promise.resolve(),
      down: (_key: string) => Promise.resolve(),
      up: (_key: string) => Promise.resolve(),
    };

    const mockPage = {
      url: () => currentUrl,
      title: () => "Mock Page Title",
      screenshot: () => Promise.resolve("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
      $: () => Promise.resolve({
        screenshot: () => Promise.resolve("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
      }),
      $$eval: () => Promise.resolve(["Mock text 1", "Mock text 2"]),
      $eval: () => Promise.resolve("Mock extracted text"),
      evaluate: (code: any, ...args: any[]) => {
        if (typeof code === 'string') {
          if (code.includes && code.includes('document.title')) return Promise.resolve('Mock Page Title');
          if (code.includes && code.includes('links')) return Promise.resolve([
            { url: 'https://example.com/link1', text: 'Link 1', internal: true, domain: 'example.com' },
            { url: 'https://example.com/link2', text: 'Link 2', internal: true, domain: 'example.com' }
          ]);
          return Promise.resolve({ mockResult: true });
        }

        if (typeof code === 'function') {
          try {
            const result = code(...args);
            return Promise.resolve(result);
          } catch {
            return Promise.resolve({
              url: currentUrl,
              title: 'Mock Page Title',
              viewport: { width: 1280, height: 720 },
              scroll: { x: 0, y: 0, maxX: 0, maxY: 2000 },
              forms: 1,
              inputs: [
                { tag: 'input', type: 'email', name: 'email', id: 'email', placeholder: 'Email', value: '', required: true, selector: '#email' },
                { tag: 'input', type: 'text', name: 'name', id: 'name', placeholder: 'Name', value: '', required: true, selector: '#name' },
              ],
              buttons: [
                { tag: 'button', text: 'Register', type: 'submit', id: 'register-btn', selector: '#register-btn' },
              ],
            });
          }
        }

        if (args && args.length >= 4) {
          return Promise.resolve([
            { url: 'https://example.com/link1', text: 'Link 1', internal: true, domain: 'example.com' },
            { url: 'https://example.com/link2', text: 'Link 2', internal: true, domain: 'example.com' }
          ]);
        }

        return Promise.resolve({ mockResult: true });
      },
      waitForSelector: () => Promise.resolve(),
      waitForNavigation: () => Promise.resolve(),
      waitForLoadState: () => Promise.resolve(),
      waitForTimeout: (ms: number) => new Promise(resolve => setTimeout(resolve, Math.min(ms, 100))),
      waitForFunction: () => Promise.resolve(),
      click: () => Promise.resolve(),
      type: (_selector: string, _text: string) => Promise.resolve(),
      focus: () => Promise.resolve(),
      fill: () => Promise.resolve(),
      select: (_selector: string, ..._values: string[]) => Promise.resolve(),
      selectOption: () => Promise.resolve(),
      hover: () => Promise.resolve(),
      close: () => Promise.resolve(),
      keyboard: mockKeyboard,
    };

    this.sessions.set(sessionId, mockPage);
    
    // Store session metadata
    const sessionMetadata: BrowserSession = {
      id: sessionId,
      url: options.url,
      viewport: options.viewport || { width: 1280, height: 720 },
      userAgent: options.userAgent,
      cookies: options.cookies,
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'active'
    };
    this.sessionMetadata.set(sessionId, sessionMetadata);

    return mockPage;
  }

  async getSession(sessionId: string): Promise<any | null> {
    const page = this.sessions.get(sessionId);
    if (page) {
      // Update last activity
      const metadata = this.sessionMetadata.get(sessionId);
      if (metadata) {
        metadata.lastActivity = new Date();
        metadata.status = 'active';
      }
    }
    return page || null;
  }

  async getOrCreateSession(sessionId: string, options: NavigationOptions): Promise<any> {
    let page = await this.getSession(sessionId);
    if (!page) {
      page = await this.createSession(sessionId, options);
    }
    return page;
  }

  async navigateSession(sessionId: string, options: NavigationOptions): Promise<void> {
    const page = await this.getSession(sessionId);
    if (!page) {
      throw new Error(`Session ${sessionId} not found`);
    }
    // Mock navigation - just update the URL
    page.url = () => options.url;
  }

  async closeSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    const metadata = this.sessionMetadata.get(sessionId);
    if (metadata) {
      metadata.status = 'closed';
      this.sessionMetadata.delete(sessionId);
    }
  }

  async getSessionMetadata(sessionId: string): Promise<BrowserSession | null> {
    return this.sessionMetadata.get(sessionId) || null;
  }

  async listSessions(): Promise<BrowserSession[]> {
    return Array.from(this.sessionMetadata.values());
  }

  async cleanupIdleSessions(): Promise<void> {
    // Mock cleanup - just clear old sessions
    const timeoutMs = parseInt(this.env.SESSION_TIMEOUT_MS) || 300000;
    const now = new Date();

    for (const [sessionId, metadata] of this.sessionMetadata.entries()) {
      const idleTime = now.getTime() - metadata.lastActivity.getTime();
      if (idleTime > timeoutMs) {
        await this.closeSession(sessionId);
      }
    }
  }

  async cleanup(): Promise<void> {
    this.sessions.clear();
    this.sessionMetadata.clear();
  }

  isAtSessionLimit(): boolean {
    const maxSessions = parseInt(this.env.MAX_CONCURRENT_SESSIONS) || 5;
    return this.sessions.size >= maxSessions;
  }

  getSessionCount(): number {
    return this.sessions.size;
  }
}
