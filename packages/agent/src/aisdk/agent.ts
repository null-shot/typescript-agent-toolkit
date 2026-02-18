import { ModelMessage, LanguageModel, StreamTextResult, ToolSet, streamText, wrapLanguageModel } from 'ai';
import { isMiddlewareService, MiddlewareService, StreamTextWithMessagesParams, StreamTextWithPromptParams } from './middleware';
import { NullShotAgent } from '../agent';
import { AgentEnv } from '../env';
import { Service } from '../service';

/**
 * A message from the AI UI SDK - Could not find this in the ai package
 */
export interface AIUISDKMessage {
	id: string;
	messages: ModelMessage[];
}

/**
 * A wrapper around the AI SDK's to support AI UI SDK and enhanced middleware support
 */
export abstract class AiSdkAgent<ENV extends AgentEnv> extends NullShotAgent<ENV, AIUISDKMessage> {
	protected model: LanguageModel;
	protected middleware: MiddlewareService[] = [];

	constructor(state: DurableObjectState, env: ENV, model: string | LanguageModel, services: Service[] = []) {
		super(state, env, services);
		this.model = model;
	}

	protected override async initializeServices(): Promise<void> {
		console.log(`🔧 AiSdkAgent.initializeServices: Starting, services count: ${this.services.length}`)
		await super.initializeServices();
		console.log(`✅ AiSdkAgent.initializeServices: super.initializeServices() completed`)

		for (const service of this.services) {
			console.log(`🔍 AiSdkAgent.initializeServices: Processing service "${service.name || 'unnamed'}"`)
			// Register middleware for middleware services
			if (isMiddlewareService(service)) {
				console.log(`✅ AiSdkAgent.initializeServices: Registering middleware service "${service.name}"`)
				this.middleware.push(service);
			} else {
				console.log(`⏭️  AiSdkAgent.initializeServices: Service "${service.name}" is not a middleware service`)
			}
		}

		console.log(`✅ AiSdkAgent.initializeServices: Registered ${this.middleware.length} middleware services`)
		
		// NOTE: wrapLanguageModel is NOT used for ToolboxService because it only provides
		// transformStreamTextTools. The model wrapping is only needed for middleware that
		// implements wrapGenerate or wrapStream methods.
		// Tools are injected directly via enrichParamsWithTools in streamTextWithMessages.

		return Promise.resolve();
	}

	/**
	 * Stream text with messages (conversation mode)
	 */
	protected async streamTextWithMessages(
		sessionId: string,
		messages: ModelMessage[],
		options: Omit<Partial<StreamTextWithMessagesParams>, 'model' | 'messages'> = {},
	): Promise<StreamTextResult<ToolSet, string>> {
		console.log(`🔧 AiSdkAgent.streamTextWithMessages: Starting, sessionId=${sessionId}, messages=${messages.length}`)
		console.log(`🔧 AiSdkAgent.streamTextWithMessages: Middleware services: ${this.middleware.length}`)
		
		const params: StreamTextWithMessagesParams = {
			model: this.model,
			messages,
			experimental_generateMessageId: () => `${sessionId}-${crypto.randomUUID()}`,
			...options,
		};

		// Enrich with tools via middleware
		console.log(`🔧 AiSdkAgent.streamTextWithMessages: Before enrichParamsWithTools, params.tools=${params.tools ? Object.keys(params.tools).length : 0}`)
		this.enrichParamsWithTools(params);
		console.log(`🔧 AiSdkAgent.streamTextWithMessages: After enrichParamsWithTools, params.tools=${params.tools ? Object.keys(params.tools).length : 0}`)
		if (params.tools) {
			console.log(`🛠️  AiSdkAgent.streamTextWithMessages: Tools that will be sent to AI SDK: ${Object.keys(params.tools).join(', ')}`)
		} else {
			console.warn(`⚠️  AiSdkAgent.streamTextWithMessages: NO TOOLS will be sent to AI SDK!`)
		}

		// Call AI SDK v5 streamText - no casting needed!
		console.log(`🚀 AiSdkAgent.streamTextWithMessages: Calling streamText() with ${params.tools ? Object.keys(params.tools).length : 0} tools`)
		return streamText(params);
	}

	/**
	 * Stream text with prompt (single prompt mode)
	 */
	protected async streamTextWithPrompt(
		sessionId: string,
		prompt: string,
		options: Omit<Partial<StreamTextWithPromptParams>, 'model' | 'prompt'> = {},
	): Promise<StreamTextResult<ToolSet, string>> {
		const params: StreamTextWithPromptParams = {
			model: this.model,
			prompt,
			experimental_generateMessageId: () => `${sessionId}-${crypto.randomUUID()}`,
			...options,
		};

		// Enrich with tools via middleware
		this.enrichParamsWithTools(params);

		// Call AI SDK v5 streamText - no casting needed!
		return streamText(params);
	}

	/**
	 * Common logic to enrich parameters with tools via middleware
	 */
	private enrichParamsWithTools(params: StreamTextWithMessagesParams | StreamTextWithPromptParams): void {
		// Apply middleware transformations for tools
		// Note: If model is a string and we have middleware, we can only apply tool transformations
		// The wrapLanguageModel middleware (wrapGenerate, wrapStream) only works with LanguageModelV2 objects
		console.log(`🔧 enrichParamsWithTools: ${this.middleware.length} middleware services available`);
		for (const middleware of this.middleware) {
			if (middleware.transformStreamTextTools) {
				const beforeTools = params.tools ? Object.keys(params.tools).length : 0;
				params.tools = middleware.transformStreamTextTools(params.tools);
				const afterTools = params.tools ? Object.keys(params.tools).length : 0;
				console.log(`✅ Transformed tools with middleware "${middleware.name || 'unnamed'}": ${beforeTools} -> ${afterTools} tools`);
				if (params.tools) {
					const toolNames = Object.keys(params.tools);
					console.log(`🛠️  Available tools (${toolNames.length}): ${toolNames.join(', ')}`);
					// Log tool details for debugging
					for (const [toolName, toolDef] of Object.entries(params.tools)) {
						console.log(`  - ${toolName}: ${(toolDef as any).description || 'no description'}`);
					}
				} else {
					console.log(`⚠️  No tools available after transformation`);
				}
			}
		}
	}
}
