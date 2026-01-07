import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { applyPermissionlessAgentSessionRouter } from '@nullshot/agent';
import { AiSdkAgent, AIUISDKMessage } from '@nullshot/agent/aisdk';
import { Service } from '@nullshot/agent';
import { ToolboxService } from '@nullshot/agent/services';
import { LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createXai } from '@ai-sdk/xai';
import { createWorkersAI } from 'workers-ai-provider';

// Agent that uses Cloudflare Queues with configurable AI providers
export class QueueAgent extends AiSdkAgent<Env> {
	constructor(state: DurableObjectState, env: Env) {
		// Mock mode: use dummy model for local testing without API keys
		if (env.USE_MOCK_AI === 'true') {
			super(state, env, {} as LanguageModel, [new ToolboxService(env)]);
			return;
		}

		// Determine AI provider from environment
		const providerName = (env.AI_PROVIDER || 'workers-ai').toLowerCase();
		let provider: any;
		let model: LanguageModel;

		switch (providerName) {
			case 'anthropic':
				if (!env.ANTHROPIC_API_KEY) {
					throw new Error('ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic');
				}
				provider = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
				model = provider.languageModel('claude-3-haiku-20240307');
				break;

			case 'openai':
				if (!env.OPEN_AI_API_KEY) {
					throw new Error('OPEN_AI_API_KEY is required when AI_PROVIDER=openai');
				}
				provider = createOpenAI({ apiKey: env.OPEN_AI_API_KEY });
				model = provider.languageModel('gpt-4o-mini');
				break;

			case 'google':
			case 'gemini':
				if (!env.GOOGLE_API_KEY) {
					throw new Error('GOOGLE_API_KEY is required when AI_PROVIDER=google');
				}
				provider = createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY });
				model = provider.languageModel('gemini-1.5-flash');
				break;

			case 'deepseek':
				if (!env.DEEPSEEK_API_KEY) {
					throw new Error('DEEPSEEK_API_KEY is required when AI_PROVIDER=deepseek');
				}
				provider = createDeepSeek({ apiKey: env.DEEPSEEK_API_KEY });
				model = provider.languageModel('deepseek-chat');
				break;

			case 'xai':
			case 'grok':
				if (!env.GROK_API_KEY) {
					throw new Error('GROK_API_KEY is required when AI_PROVIDER=grok');
				}
				provider = createXai({ apiKey: env.GROK_API_KEY });
				model = provider.languageModel('grok-beta');
				break;

			case 'workers-ai':
			default:
				if (!env.AI) {
					throw new Error('AI binding missing. Configure Workers AI in wrangler.jsonc or set USE_MOCK_AI=true');
				}
				const workersai = createWorkersAI({ binding: env.AI });
				model = workersai('@cf/meta/llama-3.1-8b-instruct' as any);
				break;
		}

		const services: Service[] = [new ToolboxService(env)];
		super(state, env, model, services);
	}

	async processMessage(sessionId: string, messages: AIUISDKMessage): Promise<Response> {
		// Mock mode: return deterministic response without calling AI
		if (this.env.USE_MOCK_AI === 'true') {
			const last = messages.messages[messages.messages.length - 1];
			const userText = typeof last?.content === 'string' ? last.content : 'Hello';
			const reply = `Mock response: I received your message "${userText}". This is a mock response for local testing without API keys.`;
			// Return as SSE format to match expected format (0:"text")
			return new Response(`0:"${reply}"`, {
				headers: {
					'Content-Type': 'text/plain; charset=utf-8',
					'X-Session-Id': sessionId
				}
			});
		}

		const result = await this.streamTextWithMessages(sessionId, messages.messages, {
			system: 'You are a helpful assistant. Keep responses concise.',
			maxSteps: 5,
		});
		return result.toTextStreamResponse();
	}
}

// Hono app for producer and agent gateway
const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());

// Root endpoint - provide agent metadata
app.get('/', (c) => {
	return c.json({
		name: 'Queues Agent',
		version: '0.0.1',
		description: 'Agent that uses Cloudflare Queues for asynchronous message processing',
		endpoints: {
			'/': 'Agent metadata (this endpoint)',
			'/enqueue': 'Enqueue messages for async processing',
			'/result/:sessionId': 'Get result for a session',
			'/agent/chat/:sessionId': 'Direct chat endpoint (synchronous)',
		},
		features: ['Queue-based processing', 'Async message handling', 'Result caching in KV'],
	});
});

// Simple enqueue endpoint: { sessionId, messages }
app.post('/enqueue', async (c) => {
	const body = await c.req.json<any>();
	const sessionId: string = body.sessionId || crypto.randomUUID();
	const messages = body.messages || [{ role: 'user', content: 'Hello!' }];

	await c.env.REQUEST_QUEUE.send({ sessionId, messages });

	return c.json({ enqueued: true, sessionId });
});

// Fetch latest result for session
app.get('/result/:sessionId', async (c) => {
	const sessionId = c.req.param('sessionId');
	const value = await c.env.RESULTS_KV.get(`result:${sessionId}`);
	if (!value) return c.json({ result: null }, 200);
	return c.json({ result: value }, 200);
});

// Route /agent/chat/:sessionId to the DO agent
applyPermissionlessAgentSessionRouter(app);

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return app.fetch(request, env, ctx);
	},

	// Queue consumer: run messages through the Agent DO
	async queue(batch: MessageBatch<any>, env: Env, ctx: ExecutionContext) {
		for (const msg of batch.messages) {
			try {
				const { sessionId, messages } = msg.body || {};
				if (!sessionId || !messages) {
					console.warn('Invalid queue message, skipping');
					continue;
				}
				const id = env.AGENT.idFromName(sessionId);
				const req = new Request('https://internal/agent/chat/' + sessionId, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: crypto.randomUUID(), messages }),
				});
				// Synchronously fetch the agent and persist full text to KV for retrieval
				const resp = await env.AGENT.get(id).fetch(req);
				const text = await resp.text();
				ctx.waitUntil(
					env.RESULTS_KV.put(`result:${sessionId}`, text, {
						expirationTtl: 60 * 60,
					}),
				);
			} catch (e) {
				console.error('Queue processing error:', e);
				throw e;
			}
		}
	},
};
