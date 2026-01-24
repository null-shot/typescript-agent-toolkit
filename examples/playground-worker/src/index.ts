import { Hono } from "hono";
import { cors } from "hono/cors";

interface Env {
	AGENT_SERVICE?: Fetcher;  // Service binding to simple-prompt-agent
	DEPENDENT_AGENT_SERVICE?: Fetcher;  // Service binding to dependent-agent
	AGENT_URL?: string;  // Default agent URL
	AGENTS?: string;  // Format: "name1|url1|desc1,name2|url2|desc2"
	ASSETS?: Fetcher;  // Static assets binding
}

interface Agent {
	id: string;
	name: string;
	url: string;
	description?: string;
}

/**
 * Parse agents from environment variable
 * Format: "name1|url1|description1,name2|url2|description2"
 */
function parseAgentsFromEnv(envValue: string | undefined, defaultUrl: string): Agent[] {
	const agents: Agent[] = [];
	
	if (envValue && envValue.trim() !== "") {
		const entries = envValue.split(",");
		for (const entry of entries) {
			const parts = entry.trim().split("|");
			if (parts.length >= 2) {
				const name = parts[0].trim();
				const url = parts[1].trim();
				const description = parts[2]?.trim();
				
				if (name && url) {
					agents.push({
						id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
						name,
						url,
						description,
					});
				}
			}
		}
	}
	
	// If no agents parsed, add default
	if (agents.length === 0) {
		agents.push({
			id: "default",
			name: "Simple Prompt Agent",
			url: defaultUrl,
			description: "Default AI assistant",
		});
	}
	
	return agents;
}

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use("*", cors({
	origin: "*",
	allowMethods: ["GET", "POST", "OPTIONS"],
	allowHeaders: ["Content-Type"],
}));

// Health check endpoint
app.get("/health", (c) => {
	return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Proxy endpoint for agent chat
app.post("/api/agent/chat/:sessionId?", async (c) => {
	const sessionId = c.req.param("sessionId") || crypto.randomUUID();
	const body = await c.req.json();
	const agentUrl = c.req.query("agentUrl");
	
	// Get agent URL from query param or use default
	const defaultAgentUrl = c.env.AGENT_URL || "https://simple-prompt-agent.gribaart.workers.dev";
	const targetAgentUrl = agentUrl || defaultAgentUrl;
	
	// Determine which service binding to use based on URL
	const isDefaultAgent = !agentUrl || agentUrl === defaultAgentUrl || agentUrl.includes("simple-prompt-agent");
	const isDependentAgent = agentUrl?.includes("agent-dependencies") || agentUrl?.includes("dependent-agent");
	
	let serviceBinding: Fetcher | undefined;
	if (isDefaultAgent && c.env.AGENT_SERVICE) {
		serviceBinding = c.env.AGENT_SERVICE;
	} else if (isDependentAgent && c.env.DEPENDENT_AGENT_SERVICE) {
		serviceBinding = c.env.DEPENDENT_AGENT_SERVICE;
	}
	
	const useServiceBinding = !!serviceBinding;
	
	console.log(`📡 Proxying request to agent: ${targetAgentUrl} (Service Binding: ${useServiceBinding})`);
	console.log(`📡 Session ID: ${sessionId}`);
	
	try {
		const url = useServiceBinding
			? `https://service-binding/agent/chat/${sessionId}`
			: `${targetAgentUrl}/agent/chat/${sessionId}`;
		
		const request = new Request(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
		
		// Use Service Binding if available, otherwise HTTP fetch
		const response = useServiceBinding && serviceBinding
			? await serviceBinding.fetch(request)
			: await fetch(request);
		
		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			console.error(`❌ Agent error: ${response.status} ${errorText}`);
			return c.json({ error: errorText }, response.status as 400 | 500);
		}
		
		// Return streaming response
		return new Response(response.body, {
			headers: {
				"Content-Type": response.headers.get("Content-Type") || "text/plain",
				"X-Session-Id": sessionId,
			},
		});
	} catch (error) {
		console.error("❌ Proxy error:", error);
		return c.json(
			{ error: error instanceof Error ? error.message : "Unknown error" },
			500
		);
	}
});

// Agent health check
app.get("/api/agent/health", async (c) => {
	const agentUrl = c.req.query("agentUrl");
	const defaultAgentUrl = c.env.AGENT_URL || "https://simple-prompt-agent.gribaart.workers.dev";
	const targetAgentUrl = agentUrl || defaultAgentUrl;
	
	// Determine which service binding to use based on URL
	const isDefaultAgent = !agentUrl || agentUrl === defaultAgentUrl || agentUrl.includes("simple-prompt-agent");
	const isDependentAgent = agentUrl?.includes("agent-dependencies") || agentUrl?.includes("dependent-agent");
	
	let serviceBinding: Fetcher | undefined;
	if (isDefaultAgent && c.env.AGENT_SERVICE) {
		serviceBinding = c.env.AGENT_SERVICE;
	} else if (isDependentAgent && c.env.DEPENDENT_AGENT_SERVICE) {
		serviceBinding = c.env.DEPENDENT_AGENT_SERVICE;
	}
	
	const useServiceBinding = !!serviceBinding;
	
	try {
		const url = useServiceBinding
			? "https://service-binding/"
			: `${targetAgentUrl}/`;
		
		const request = new Request(url, { method: "GET" });
		const response = useServiceBinding && serviceBinding
			? await serviceBinding.fetch(request)
			: await fetch(request);
		
		return c.json({
			isOnline: response.ok || response.status === 404, // 404 is ok, means agent exists
			status: response.status,
			timestamp: Date.now(),
		});
	} catch (error) {
		return c.json({
			isOnline: false,
			error: error instanceof Error ? error.message : "Unknown error",
			timestamp: Date.now(),
		});
	}
});

// Serve static assets or return HTML
app.get("*", async (c) => {
	// If ASSETS binding is available, serve from it
	if (c.env.ASSETS) {
		const url = new URL(c.req.url);
		const assetResponse = await c.env.ASSETS.fetch(new Request(url));
		if (assetResponse.status !== 404) {
			return assetResponse;
		}
	}
	
	// Get preset agents from ENV (or use defaults)
	const defaultAgentUrl = c.env.AGENT_URL || "https://simple-prompt-agent.gribaart.workers.dev";
	const presetAgents = parseAgentsFromEnv(c.env.AGENTS, defaultAgentUrl);
	const presetAgentsJson = JSON.stringify(presetAgents);
	
	// Otherwise, return simple HTML interface
	return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>AI Agent Playground</title>
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			min-height: 100vh;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 20px;
		}
		.container {
			background: white;
			border-radius: 16px;
			box-shadow: 0 20px 60px rgba(0,0,0,0.3);
			width: 100%;
			max-width: 800px;
			height: 600px;
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}
		.header {
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			color: white;
			padding: 16px 20px;
			display: flex;
			flex-direction: column;
			gap: 12px;
		}
		.header-top {
			display: flex;
			justify-content: space-between;
			align-items: center;
			flex-wrap: wrap;
			gap: 12px;
		}
		.header h1 { font-size: 20px; margin: 0; }
		.agent-selector {
			display: flex;
			gap: 8px;
			align-items: center;
			flex-wrap: wrap;
		}
		.agent-selector select {
			padding: 6px 12px;
			border: 1px solid rgba(255,255,255,0.3);
			border-radius: 8px;
			background: rgba(255,255,255,0.2);
			color: white;
			font-size: 13px;
			cursor: pointer;
			min-width: 200px;
		}
		.agent-selector select option {
			background: #764ba2;
			color: white;
		}
		.add-agent-btn {
			padding: 6px 12px;
			border: 1px solid rgba(255,255,255,0.3);
			border-radius: 8px;
			background: rgba(255,255,255,0.2);
			color: white;
			font-size: 12px;
			cursor: pointer;
		}
		.add-agent-btn:hover {
			background: rgba(255,255,255,0.3);
		}
		.modal {
			display: none;
			position: fixed;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			background: rgba(0,0,0,0.5);
			z-index: 1000;
			align-items: center;
			justify-content: center;
		}
		.modal.active {
			display: flex;
		}
		.modal-content {
			background: white;
			padding: 24px;
			border-radius: 12px;
			max-width: 400px;
			width: 90%;
			display: flex;
			flex-direction: column;
			gap: 16px;
		}
		.modal-content h3 {
			margin: 0;
			color: #333;
		}
		.modal-content input {
			padding: 10px;
			border: 2px solid #e0e0e0;
			border-radius: 8px;
			font-size: 14px;
		}
		.modal-actions {
			display: flex;
			gap: 8px;
			justify-content: flex-end;
		}
		.modal-actions button {
			padding: 8px 16px;
			border: none;
			border-radius: 8px;
			cursor: pointer;
			font-size: 14px;
		}
		.modal-actions .btn-primary {
			background: #667eea;
			color: white;
		}
		.modal-actions .btn-secondary {
			background: #e0e0e0;
			color: #333;
		}
		.status {
			font-size: 12px;
			opacity: 0.9;
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 8px;
		}
		.status-dot {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: #ff4444;
			animation: pulse 2s infinite;
		}
		.status-dot.online { background: #44ff44; }
		@keyframes pulse {
			0%, 100% { opacity: 1; }
			50% { opacity: 0.5; }
		}
		.messages {
			flex: 1;
			overflow-y: auto;
			padding: 20px;
			display: flex;
			flex-direction: column;
			gap: 12px;
		}
		.message {
			padding: 12px 16px;
			border-radius: 12px;
			max-width: 80%;
			word-wrap: break-word;
		}
		.message.user {
			background: #667eea;
			color: white;
			align-self: flex-end;
		}
		.message.assistant {
			background: #f0f0f0;
			color: #333;
			align-self: flex-start;
		}
		.input-area {
			padding: 20px;
			border-top: 1px solid #e0e0e0;
			display: flex;
			gap: 12px;
		}
		.input-area input {
			flex: 1;
			padding: 12px 16px;
			border: 2px solid #e0e0e0;
			border-radius: 24px;
			font-size: 14px;
			outline: none;
			transition: border-color 0.2s;
		}
		.input-area input:focus {
			border-color: #667eea;
		}
		.input-area button {
			padding: 12px 24px;
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			color: white;
			border: none;
			border-radius: 24px;
			font-size: 14px;
			font-weight: 600;
			cursor: pointer;
			transition: transform 0.2s, opacity 0.2s;
		}
		.input-area button:hover:not(:disabled) {
			transform: scale(1.05);
		}
		.input-area button:disabled {
			opacity: 0.6;
			cursor: not-allowed;
		}
		.loading {
			display: inline-block;
			width: 12px;
			height: 12px;
			border: 2px solid #667eea;
			border-top-color: transparent;
			border-radius: 50%;
			animation: spin 0.6s linear infinite;
		}
		@keyframes spin {
			to { transform: rotate(360deg); }
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<div class="header-top">
				<h1>AI Agent Playground</h1>
				<div class="agent-selector">
					<select id="agentSelect"></select>
					<button class="add-agent-btn" id="addAgentBtn">+ Add Agent</button>
					<button class="add-agent-btn" id="newChatBtn" style="background: #ff6b6b;">🗑️ New Chat</button>
				</div>
			</div>
			<div class="status">
				<span class="status-dot" id="statusDot"></span>
				<span id="statusText">Checking connection...</span>
			</div>
		</div>
		<div class="messages" id="messages"></div>
		<div class="input-area">
			<input type="text" id="messageInput" placeholder="Type your message..." />
			<button id="sendButton">Send</button>
		</div>
	</div>
	
	<!-- Add Agent Modal -->
	<div class="modal" id="addAgentModal">
		<div class="modal-content">
			<h3>Add New Agent</h3>
			<input type="text" id="agentNameInput" placeholder="Agent Name" />
			<input type="text" id="agentUrlInput" placeholder="Agent URL (e.g., https://agent.example.com)" />
			<div class="modal-actions">
				<button class="btn-secondary" id="cancelBtn">Cancel</button>
				<button class="btn-primary" id="saveAgentBtn">Save</button>
			</div>
		</div>
	</div>
	
	<script>
		// Preset agents from server configuration (injected at render time)
		const PRESET_AGENTS = ${presetAgentsJson};
		
		let sessionId = crypto.randomUUID();
		let isConnected = false;
		let agents = [];
		let currentAgent = null;
		
		const messagesDiv = document.getElementById('messages');
		const messageInput = document.getElementById('messageInput');
		const sendButton = document.getElementById('sendButton');
		const statusDot = document.getElementById('statusDot');
		const statusText = document.getElementById('statusText');
		const agentSelect = document.getElementById('agentSelect');
		const addAgentBtn = document.getElementById('addAgentBtn');
		const newChatBtn = document.getElementById('newChatBtn');
		const addAgentModal = document.getElementById('addAgentModal');
		const agentNameInput = document.getElementById('agentNameInput');
		const agentUrlInput = document.getElementById('agentUrlInput');
		const saveAgentBtn = document.getElementById('saveAgentBtn');
		const cancelBtn = document.getElementById('cancelBtn');
		
		// Load agents: preset from server + custom from localStorage
		function loadAgents() {
			// Start with preset agents (from ENV config)
			const presetAgents = [...PRESET_AGENTS];
			
			// Load custom agents from localStorage
			let customAgents = [];
			try {
				const saved = localStorage.getItem('customAgents');
				if (saved) {
					customAgents = JSON.parse(saved);
				}
			} catch (e) {
				console.error('Failed to load custom agents:', e);
			}
			
			// Merge: preset agents first, then custom (no duplicates by URL)
			const presetUrls = new Set(presetAgents.map(a => a.url));
			const uniqueCustom = customAgents.filter(a => !presetUrls.has(a.url));
			
			agents = [...presetAgents, ...uniqueCustom];
			
			updateAgentSelect();
			if (agents.length > 0) {
				currentAgent = agents[0];
				agentSelect.value = currentAgent.id;
			}
		}
		
		// Save custom agents to localStorage (only user-added ones)
		function saveAgents() {
			try {
				// Only save custom agents (those added by user, not from API)
				// We identify custom agents by checking if they have isCustom flag
				const customAgents = agents.filter(a => a.isCustom);
				localStorage.setItem('customAgents', JSON.stringify(customAgents));
			} catch (e) {
				console.error('Failed to save agents:', e);
			}
		}
		
		// Update agent select dropdown
		function updateAgentSelect() {
			agentSelect.innerHTML = '';
			agents.forEach(agent => {
				const option = document.createElement('option');
				option.value = agent.id;
				option.textContent = agent.name;
				agentSelect.appendChild(option);
			});
		}
		
		// Add new agent
		function addAgent(name, url) {
			// Validate URL
			try {
				new URL(url);
			} catch {
				alert('Invalid URL format');
				return;
			}
			
			// Check for duplicates
			if (agents.some(a => a.url === url)) {
				alert('Agent with this URL already exists');
				return;
			}
			
			const newAgent = {
				id: crypto.randomUUID(),
				name: name || \`Agent \${agents.length + 1}\`,
				url: url,
				isCustom: true  // Mark as custom (user-added)
			};
			
			agents.push(newAgent);
			saveAgents();
			updateAgentSelect();
			currentAgent = newAgent;
			agentSelect.value = newAgent.id;
			checkHealth();
			addAgentModal.classList.remove('active');
			agentNameInput.value = '';
			agentUrlInput.value = '';
		}
		
		// Save chat history for current agent to localStorage
		function saveChatHistory() {
			if (!currentAgent) return;
			try {
				const messages = Array.from(messagesDiv.children)
					.filter(msg => msg.classList.contains('user') || msg.classList.contains('assistant'))
					.map(msg => ({
						role: msg.classList.contains('user') ? 'user' : 'assistant',
						content: msg.textContent
					}));
				localStorage.setItem(\`chat_history_\${currentAgent.id}\`, JSON.stringify(messages));
				localStorage.setItem(\`chat_session_\${currentAgent.id}\`, sessionId);
			} catch (e) {
				console.error('Failed to save chat history:', e);
			}
		}
		
		// Load chat history for agent from localStorage
		function loadChatHistory(agentId) {
			messagesDiv.innerHTML = '';
			try {
				const saved = localStorage.getItem(\`chat_history_\${agentId}\`);
				const savedSession = localStorage.getItem(\`chat_session_\${agentId}\`);
				if (saved) {
					const messages = JSON.parse(saved);
					messages.forEach(msg => addMessage(msg.role, msg.content));
				}
				if (savedSession) {
					sessionId = savedSession;
				} else {
					sessionId = crypto.randomUUID();
				}
			} catch (e) {
				console.error('Failed to load chat history:', e);
				sessionId = crypto.randomUUID();
			}
		}
		
		// Agent selection change
		agentSelect.addEventListener('change', (e) => {
			const selected = agents.find(a => a.id === e.target.value);
			if (selected) {
				// Save current chat history before switching
				saveChatHistory();
				currentAgent = selected;
				// Load chat history for new agent
				loadChatHistory(selected.id);
				checkHealth();
			}
		});
		
		// Add agent button
		addAgentBtn.addEventListener('click', () => {
			addAgentModal.classList.add('active');
			agentNameInput.focus();
		});
		
		// New chat button - clear history and start fresh
		newChatBtn.addEventListener('click', () => {
			if (!currentAgent) return;
			if (!confirm('Clear chat history and start a new conversation?')) return;
			
			// Clear localStorage for current agent
			localStorage.removeItem(\`chat_history_\${currentAgent.id}\`);
			localStorage.removeItem(\`chat_session_\${currentAgent.id}\`);
			
			// Clear messages and generate new session
			messagesDiv.innerHTML = '';
			sessionId = crypto.randomUUID();
			
			// Add welcome message
			addMessage('assistant', \`Connected to \${currentAgent.name}. How can I help you?\`);
		});
		
		// Save agent
		saveAgentBtn.addEventListener('click', () => {
			const name = agentNameInput.value.trim();
			const url = agentUrlInput.value.trim();
			if (!url) {
				alert('URL is required');
				return;
			}
			addAgent(name, url);
		});
		
		// Cancel
		cancelBtn.addEventListener('click', () => {
			addAgentModal.classList.remove('active');
			agentNameInput.value = '';
			agentUrlInput.value = '';
		});
		
		// Close modal on outside click
		addAgentModal.addEventListener('click', (e) => {
			if (e.target === addAgentModal) {
				addAgentModal.classList.remove('active');
			}
		});
		
		// Enter key in modal inputs
		agentUrlInput.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') saveAgentBtn.click();
		});
		
		// Check agent health
		async function checkHealth() {
			if (!currentAgent) return;
			
			try {
				const url = \`/api/agent/health?agentUrl=\${encodeURIComponent(currentAgent.url)}\`;
				const response = await fetch(url);
				const data = await response.json();
				isConnected = data.isOnline;
				
				if (isConnected) {
					statusDot.classList.add('online');
					statusText.textContent = \`Connected to \${currentAgent.name}\`;
				} else {
					statusDot.classList.remove('online');
					statusText.textContent = \`Disconnected from \${currentAgent.name}\`;
				}
			} catch (error) {
				isConnected = false;
				statusDot.classList.remove('online');
				statusText.textContent = \`Error checking \${currentAgent.name}\`;
			}
		}
		
		// Add message to chat
		function addMessage(role, text) {
			const messageDiv = document.createElement('div');
			messageDiv.className = \`message \${role}\`;
			messageDiv.textContent = text;
			messagesDiv.appendChild(messageDiv);
			messagesDiv.scrollTop = messagesDiv.scrollHeight;
		}
		
		// Send message
		async function sendMessage() {
			const text = messageInput.value.trim();
			if (!text || !isConnected) return;
			
			// Add user message
			addMessage('user', text);
			messageInput.value = '';
			sendButton.disabled = true;
			sendButton.innerHTML = '<span class="loading"></span>';
			
			// Get all messages for context
			const allMessages = Array.from(messagesDiv.children)
				.filter(msg => msg.classList.contains('user') || msg.classList.contains('assistant'))
				.map(msg => ({
					role: msg.classList.contains('user') ? 'user' : 'assistant',
					content: msg.textContent
				}));
			
			if (!currentAgent) {
				alert('Please select an agent first');
				return;
			}
			
			try {
				const url = \`/api/agent/chat/\${sessionId}?agentUrl=\${encodeURIComponent(currentAgent.url)}\`;
				const response = await fetch(url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						id: sessionId,
						messages: allMessages
					})
				});
				
				if (!response.ok) {
					throw new Error(\`Agent error: \${response.status}\`);
				}
				
				// Create assistant message div
				const assistantMsgDiv = document.createElement('div');
				assistantMsgDiv.className = 'message assistant';
				messagesDiv.appendChild(assistantMsgDiv);
				
				// Stream response
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let fullText = '';
				
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					
					const chunk = decoder.decode(value, { stream: true });
					
					// Parse different formats
					// Format: 0:"text"
					if (chunk.match(/^\\d+:"/)) {
						const match = chunk.match(/^\\d+:"(.*)"$/s);
						if (match) {
							fullText = match[1].replace(/\\\\"/g, '"').replace(/\\\\n/g, '\\n');
						}
					} else {
						fullText += chunk;
					}
					
					assistantMsgDiv.textContent = fullText;
					messagesDiv.scrollTop = messagesDiv.scrollHeight;
				}
			} catch (error) {
				addMessage('assistant', \`Error: \${error.message}\`);
			} finally {
				sendButton.disabled = false;
				sendButton.textContent = 'Send';
				// Save chat history after each message exchange
				saveChatHistory();
			}
		}
		
		// Event listeners
		sendButton.addEventListener('click', sendMessage);
		messageInput.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') sendMessage();
		});
		
		// Initialize
		loadAgents();
		// Load chat history for initially selected agent
		if (currentAgent) {
			loadChatHistory(currentAgent.id);
		}
		checkHealth();
		setInterval(checkHealth, 30000); // Check every 30 seconds
	</script>
</body>
</html>`);
});

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return app.fetch(request, env, ctx);
	},
};
