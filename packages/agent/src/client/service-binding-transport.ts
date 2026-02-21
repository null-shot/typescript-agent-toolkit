import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

/**
 * ServiceBindingSSEClientTransport extends the official SSEClientTransport
 * to route MCP requests through Cloudflare service bindings instead of HTTP.
 * 
 * This allows MCP servers deployed as Cloudflare Workers to be called directly
 * via service bindings without exposing public URLs.
 *
 * Supports an optional AbortSignal to cancel the SSE connection (critical for
 * staying within Cloudflare free-tier DO duration limits).
 */
export class ServiceBindingSSEClientTransport extends SSEClientTransport {
  private serviceBinding: Fetcher;

  constructor(serviceBinding: Fetcher, endpoint: string = '/sse', abortSignal?: AbortSignal) {
    const dummyUrl = new URL(endpoint, 'https://service-binding');
    
    const fetchOverride: typeof fetch = async (
      fetchUrl: RequestInfo | URL,
      fetchInit: RequestInit = {}
    ) => {
      const request = new Request(fetchUrl.toString(), {
        ...fetchInit,
        headers: {
          ...fetchInit?.headers,
        },
        signal: abortSignal ?? fetchInit?.signal,
      });
      
      return await serviceBinding.fetch(request);
    };

    super(dummyUrl, { 
      eventSourceInit: {
        fetch: fetchOverride
      }
    });
    
    this.serviceBinding = serviceBinding;
  }

  /**
   * Override the send method to route requests through service bindings
   */
  async send(message: JSONRPCMessage): Promise<void> {
    // Get the endpoint from the private property
    // @ts-ignore - Accessing private property
    const endpoint = this._endpoint;
    
    if (!endpoint) {
      throw new Error("Not connected to service binding");
    }

    try {
      // Set up headers for JSON-RPC
      const headers = new Headers();
      headers.set("content-type", "application/json");

      const init = {
        method: "POST",
        headers,
        body: JSON.stringify(message),
      };

      // Route the request through the service binding
      const request = new Request(endpoint.toString(), init);
      const response = await this.serviceBinding.fetch(request);

      if (!response.ok) {
        const text = await response.text().catch(() => null);
        throw new Error(
          `Error POSTing to service binding endpoint (HTTP ${response.status}): ${text}`,
        );
      }
    } catch (error) {
      this.onerror?.(error as Error);
      throw error;
    }
  }
}
