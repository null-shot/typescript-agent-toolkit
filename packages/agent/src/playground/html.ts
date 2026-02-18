/**
 * Playground HTML Generator
 * Generates inline HTML for the lightweight playground UI
 * Adapted from examples/playground-worker for single-worker architecture
 *
 * Supports:
 * - Multi-agent chat interface (default tab)
 * - Tabbed UI with dashboard and custom tabs
 * - Telegram Agents dashboard for bot monitoring
 */

import type { PlaygroundOptions, PlaygroundAgent, PlaygroundTab } from './types';
import { generateStyles } from './styles';

/**
 * Default agents if none provided
 */
const DEFAULT_AGENTS: PlaygroundAgent[] = [
	{
		id: 'default',
		name: 'AI Agent',
		path: '/agent/chat',
		description: 'Default AI assistant',
	},
];

/**
 * Generate the playground HTML
 * This is a self-contained HTML page with inline CSS and JavaScript
 */
export function generatePlaygroundHTML(options: PlaygroundOptions = {}): string {
	const {
		agents = DEFAULT_AGENTS,
		tabs = [],
		title = 'AI Agent Playground',
		primaryColor = '#00d4aa',
		secondaryColor = '#14b8a6',
	} = options;

	const agentsJson = JSON.stringify(agents);
	const tabsJson = JSON.stringify(tabs);

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${title}</title>
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
	<style>${generateStyles(primaryColor, secondaryColor)}</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<div class="header-top">
				<h1>${title}</h1>
			</div>
			<div class="tab-bar" id="tabBar">
				<button class="tab-btn active" data-tab="chat">Web Agents</button>
			</div>
		</div>

		<!-- Chat Tab -->
		<div class="tab-content visible active" id="tab-chat">
			<div class="chat-header-bar">
				<div class="flex-between" style="padding:10px 16px">
					<div class="agent-selector" id="chatControls">
						<select id="agentSelect"></select>
						<button class="action-btn" id="systemPromptBtn" title="Edit System Prompt">Edit Prompt</button>
						<button class="action-btn danger" id="newChatBtn">New Chat</button>
					</div>
					<div class="status">
						<span class="status-dot" id="statusDot"></span>
						<span id="statusText">Connecting...</span>
					</div>
				</div>
				<div class="mcp-chips-bar" id="mcpChipsBar"></div>
			</div>
			<div class="messages" id="messages"></div>
			<button class="scroll-bottom-btn" id="scrollBottomBtn" title="Scroll to bottom">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
			</button>
			<div class="input-area">
				<textarea id="messageInput" placeholder="Type your message..." rows="1"></textarea>
				<button id="sendButton">Send</button>
			</div>
			<div class="input-hint"><kbd>Enter</kbd> send · <kbd>Shift+Enter</kbd> new line</div>
		</div>

		<!-- Dashboard Tab (rendered if tabs include a dashboard) -->
		<div class="tab-content" id="tab-dashboard">
			<div class="dashboard" id="dashboardContent">
				<div class="dash-loading" id="dashLoading">Loading dashboard...</div>
			</div>
		</div>
	</div>
	
	<!-- System Prompt Modal -->
	<div id="systemPromptModal" class="sp-modal-overlay" style="display:none">
		<div class="sp-modal">
			<div class="sp-modal-header">
				<span class="sp-modal-title">System Prompt</span>
				<button class="sp-modal-close" id="spModalClose">&times;</button>
			</div>
			<div class="sp-modal-body">
				<div class="sp-modal-hint">Choose a template or pick from your saved prompts.</div>
				<div class="sp-templates" id="spTemplates"></div>
				<div id="spSavedSection" style="margin-top:8px">
					<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
						<span style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px">My Prompts</span>
					</div>
					<div class="sp-templates" id="spSavedList"></div>
				</div>
				<div id="spNameRow" style="display:none;margin-bottom:6px;gap:8px;align-items:center">
					<input type="text" id="spSaveAsName" placeholder="Custom Prompt" value="Custom Prompt" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:13px">
				</div>
				<textarea id="systemPromptInput" class="sp-textarea" rows="10" placeholder="Write your custom prompt here..."></textarea>
			</div>
			<div class="sp-modal-options">
				<label class="sp-option-toggle"><input type="checkbox" id="autoVoiceCheck"><span>Auto Voice</span></label>
			</div>
			<div class="sp-modal-footer">
				<button class="action-btn" id="spSaveLibBtn" style="display:none">Save to My Prompts</button>
				<button class="action-btn primary" id="spSaveBtn">Use</button>
			</div>
		</div>
	</div>

	<script>
		// ═══════════════════════════════════════════════
		// Configuration (injected from server)
		// ═══════════════════════════════════════════════
		const AGENTS = ${agentsJson};
		const TABS = ${tabsJson};
		const NEWLINE_CHAR = String.fromCharCode(10);
		
		let sessionId = crypto.randomUUID();
		let isConnected = false;
		let currentAgent = null;
		let currentTab = 'chat';
		let dashboardData = null;
		let dashboardInterval = null;
		let dashboardAuthenticated = false;
		
		// ═══════════════════════════════════════════════
		// Dashboard PIN Authentication
		// ═══════════════════════════════════════════════
		
		function getDashboardPin() {
			return localStorage.getItem('dashboard_pin') || '';
		}
		
		function setDashboardPin(pin) {
			localStorage.setItem('dashboard_pin', pin);
		}
		
		function clearDashboardPin() {
			localStorage.removeItem('dashboard_pin');
			dashboardAuthenticated = false;
		}
		
		/**
		 * Wrapper around fetch that adds the dashboard PIN header.
		 * If the server returns 401/403, shows the login form.
		 */
		async function authFetch(url, options) {
			const pin = getDashboardPin();
			const headers = {
				...(options?.headers || {}),
				...(pin ? { 'X-Dashboard-Pin': pin } : {}),
			};
			const response = await fetch(url, { ...options, headers });
			
			if (response.status === 401 || response.status === 403) {
				clearDashboardPin();
				showPinLogin();
				throw new Error('AUTH_REQUIRED');
			}
			return response;
		}
		
		function showPinLogin(errorMsg) {
			dashboardAuthenticated = false;
			const container = document.getElementById('dashboardContent');
			if (!container) return;
			container.innerHTML = '<div class="centered-panel">' +
				'<div class="centered-panel-inner">' +
				'<div class="icon-circle"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>' +
				'<h2>Dashboard Access</h2>' +
				'<p>Enter the PIN sent by the Telegram bot.<br>Send <b>/start</b> or <b>/pin</b> to get your PIN.</p>' +
				(errorMsg ? '<div class="error-msg section-block">' + errorMsg + '</div>' : '') +
				'<input id="pinInput" type="text" inputmode="numeric" maxlength="6" placeholder="000000" ' +
				'class="pin-input" autocomplete="one-time-code" />' +
				'<br><button onclick="submitPin()" class="pin-btn">Unlock</button>' +
				'<button onclick="clearDashboardPin();showPinLogin()" class="link-btn-subtle">Clear saved PIN</button>' +
				'</div></div>';
			
			const pinInput = document.getElementById('pinInput');
			if (pinInput) {
				pinInput.focus();
				pinInput.addEventListener('keydown', function(e) {
					if (e.key === 'Enter') submitPin();
				});
			}
		}
		
		async function submitPin() {
			const pinInput = document.getElementById('pinInput');
			if (!pinInput) return;
			const pin = pinInput.value.trim();
			if (!pin) return;
			
			// Disable button while checking
			var unlockBtn = document.querySelector('#dashboardContent button');
			if (unlockBtn) { unlockBtn.disabled = true; unlockBtn.textContent = 'Checking...'; }
			
			try {
				const response = await fetch('/api/auth/login', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ pin }),
				});
				
				const data = await response.json();
				if (data.success) {
					setDashboardPin(pin);
					dashboardAuthenticated = true;
					loadDashboard(true);
				} else if (response.status === 429) {
					// Rate limited
					showPinLogin(data.error || 'Too many attempts. Please wait.');
				} else {
					showPinLogin(data.error || 'Invalid PIN');
				}
			} catch (error) {
				showPinLogin('Connection error. Please try again.');
			}
		}
		
		const messagesDiv = document.getElementById('messages');
		const messageInput = document.getElementById('messageInput');
		const sendButton = document.getElementById('sendButton');
		const statusDot = document.getElementById('statusDot');
		const statusText = document.getElementById('statusText');
		const agentSelect = document.getElementById('agentSelect');
		const newChatBtn = document.getElementById('newChatBtn');
		const chatControls = document.getElementById('chatControls');
		const tabBar = document.getElementById('tabBar');
		
		// ═══════════════════════════════════════════════
		// Tab System
		// ═══════════════════════════════════════════════
		
		function initTabs() {
			if (!tabBar || TABS.length === 0) return;
			
			TABS.forEach(tab => {
				const btn = document.createElement('button');
				btn.className = 'tab-btn';
				btn.dataset.tab = tab.id;
				btn.textContent = (tab.icon ? tab.icon + ' ' : '') + tab.label;
				tabBar.appendChild(btn);
			});
			
			// Tab click handlers
			tabBar.querySelectorAll('.tab-btn').forEach(btn => {
				btn.addEventListener('click', () => switchTab(btn.dataset.tab));
			});
		}
		
		function switchTab(tabId) {
			currentTab = tabId;
			
			// Update tab buttons
			document.querySelectorAll('.tab-btn').forEach(btn => {
				btn.classList.toggle('active', btn.dataset.tab === tabId);
			});
			
			// Fade transition: hide old, show new
			document.querySelectorAll('.tab-content').forEach(content => {
				const isTarget = content.id === 'tab-' + tabId;
				if (isTarget) {
					content.classList.add('visible');
					requestAnimationFrame(() => {
						requestAnimationFrame(() => { content.classList.add('active'); });
					});
				} else {
					content.classList.remove('active');
					content.addEventListener('transitionend', function handler() {
						if (!content.classList.contains('active')) content.classList.remove('visible');
						content.removeEventListener('transitionend', handler);
					});
					// Fallback: remove after transition duration
					setTimeout(() => { if (!content.classList.contains('active')) content.classList.remove('visible'); }, 250);
				}
			});
			
			// Load dashboard data when switching to it
			if (tabId === 'dashboard') {
				loadDashboard(true);
				if (!dashboardInterval) {
					dashboardInterval = setInterval(loadDashboard, 15000);
				}
			} else {
				if (dashboardInterval) {
					clearInterval(dashboardInterval);
					dashboardInterval = null;
				}
			}
		}
		
		// ═══════════════════════════════════════════════
		// Dashboard
		// ═══════════════════════════════════════════════
		
		let settingsData = null;
		let selectedChatId = null;
		let chatTypeMap = {};
		let currentDashTab = 'overview';
		
		async function showDashboardError(fallbackMsg) {
			const container = document.getElementById('dashboardContent');
			if (!container) return;
			let msg = fallbackMsg;
			try {
				const r = await fetch('/api/dashboard/status', { signal: AbortSignal.timeout(5000) });
				const s = await r.json();
				if (s.error) msg = s.error;
				else if (!s.configured) msg = 'Set TELEGRAM_BOT_TOKEN (wrangler secret put) and redeploy.';
				else if (!s.hasPin) msg = 'Send /pin to the bot in Telegram (owner only) to generate a PIN.';
			} catch (_) {}
			container.innerHTML = '<div class="dash-empty">Unable to load dashboard data.<br><br><span class="text-muted-xs">' + escapeHtml(msg) + '</span></div>';
		}
		
		async function loadDashboard(force) {
			const dashTab = TABS.find(t => t.id === 'dashboard');
			if (!dashTab || !dashTab.apiPath) return;
			
			// If no PIN saved, show login form
			if (!getDashboardPin()) {
				showPinLogin();
				return;
			}
			
			// Skip re-render during auto-refresh if user is editing settings
			if (!force && currentDashTab !== 'overview' && dashboardData) return;
			
			try {
				const response = await authFetch(dashTab.apiPath, {
					signal: AbortSignal.timeout(10000)
				});
				
				if (!response.ok) throw new Error('Failed to load dashboard: ' + response.status);
				
				dashboardAuthenticated = true;
				dashboardData = await response.json();
				renderDashboard(dashboardData);
			} catch (error) {
				if (error.message === 'AUTH_REQUIRED') return; // login form already shown
				console.error('[Dashboard] Load error:', error);
				const container = document.getElementById('dashboardContent');
				if (container && !dashboardData) {
					showDashboardError(error.message);
				}
			}
		}
		
		function renderDashboard(data) {
			const container = document.getElementById('dashboardContent');
			if (!container) return;
			
			const bot = data.bot || {};
			const channels = data.channels || [];
			const groups = data.groups || [];
			const moderation = data.moderation || {};
			const agentsList = data.agents || [];
			const allChats = [...channels, ...groups];
			
			// Build chat type lookup for settings rendering
			chatTypeMap = {};
			allChats.forEach(chat => {
				const cid = String(chat.chatId || chat.id);
				chatTypeMap[cid] = chat.type || 'group';
			});
			
			let html = '';
			
			// ── Top tabs: Overview / Agents Config / Tasks ──
			html += '<div class="dash-tabs-bar">';
			html += '<button class="dash-tab-btn' + (currentDashTab === 'overview' ? ' active' : '') + '" onclick="switchDashTab(\\'overview\\')">Overview</button>';
			html += '<button class="dash-tab-btn' + (currentDashTab === 'agentsconfig' ? ' active' : '') + '" onclick="switchDashTab(\\'agentsconfig\\')">Agents Config</button>';
			html += '<button class="dash-tab-btn' + (currentDashTab === 'tasks' ? ' active' : '') + '" onclick="switchDashTab(\\'tasks\\')">Tasks</button>';
			html += '<button class="dash-tab-btn dash-tab-btn-logout" onclick="clearDashboardPin();showPinLogin()" title="Sign out">Logout</button>';
			html += '</div>';
			
			// ════════════ OVERVIEW TAB ════════════
			html += '<div id="dashPanel-overview" class="dash-tab-panel' + (currentDashTab === 'overview' ? ' active' : '') + '">';
			
			// Status Cards
			html += '<div class="dash-grid">';
			html += '<div class="dash-card"><h3>Bot Status</h3>';
			html += '<div class="value">' + (bot.configured ? '<span class="badge badge-green">Online</span>' : '<span class="badge badge-gray">Not Configured</span>') + '</div>';
			html += '<div class="sub">' + (bot.username ? '@' + bot.username : 'Set TELEGRAM_BOT_TOKEN to configure') + '</div>';
			html += '</div>';
			html += '<div class="dash-card"><h3>Channels</h3><div class="value">' + channels.length + '</div><div class="sub">' + channels.filter(c => c.canPost).length + ' can post</div></div>';
			html += '<div class="dash-card"><h3>Groups</h3><div class="value">' + groups.length + '</div><div class="sub">' + groups.filter(g => g.role === 'administrator').length + ' as admin</div></div>';
			html += '</div>';
			
			// Connected Agents
			if (agentsList.length > 0) {
				html += '<div class="dash-section"><h2>Connected Agents</h2>';
				html += '<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Name</th><th>URL</th><th>Status</th></tr></thead><tbody>';
				agentsList.forEach(agent => {
					html += '<tr><td><strong>' + escapeHtml(agent.name) + '</strong></td>';
					html += '<td class="text-muted-xs">' + escapeHtml(agent.url || '-') + '</td>';
					html += '<td><span class="badge badge-green">Active</span></td></tr>';
				});
				html += '</tbody></table></div></div>';
			}
			
			// Channels & Groups
			if (allChats.length > 0) {
				// Detect linked discussion groups: supergroups with the same title as a channel
				const channelTitles = new Set(allChats.filter(c => c.type === 'channel').map(c => c.title));
				
				html += '<div class="dash-section"><h2>Channels & Groups</h2>';
				html += '<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Name</th><th>Type</th><th>Role</th><th>Can Post</th></tr></thead><tbody>';
				allChats.forEach(chat => {
					const isLinkedDiscussion = chat.type === 'supergroup' && channelTitles.has(chat.title);
					const typeLabel = chat.type === 'channel' ? 'Channel' : isLinkedDiscussion ? 'Discussion' : chat.type === 'supergroup' ? 'Supergroup' : 'Group';
					const typeBadge = chat.type === 'channel' ? 'badge-blue' : isLinkedDiscussion ? 'badge-purple' : 'badge-gray';
					html += '<tr>';
					html += '<td><strong>' + escapeHtml(chat.title || 'Unknown') + '</strong>';
					if (chat.username) html += '<br><span class="text-muted-xs">@' + escapeHtml(chat.username) + '</span>';
					if (isLinkedDiscussion) html += '<br><span class="text-muted-xs">linked discussion group</span>';
					html += '</td>';
					html += '<td><span class="badge ' + typeBadge + '">' + typeLabel + '</span></td>';
					html += '<td>' + escapeHtml(chat.role || '-') + '</td>';
					html += '<td>' + (chat.canPost ? '<span class="badge badge-green">Yes</span>' : '<span class="badge badge-red">No</span>') + '</td>';
					html += '</tr>';
				});
				html += '</tbody></table></div></div>';
			}
			
			
			// Moderation Summary
			if (moderation.enabled) {
				html += '<div class="dash-section"><h2>Moderation</h2><div class="dash-grid">';
				const stats = moderation.stats || {};
				html += '<div class="dash-card dash-card-flat"><h3>Total Actions</h3><div class="value">' + (stats.totalActions || 0) + '</div></div>';
				html += '<div class="dash-card dash-card-flat"><h3>Spam Blocked</h3><div class="value">' + (stats.spamBlocked || 0) + '</div></div>';
				html += '<div class="dash-card dash-card-flat"><h3>Users Warned</h3><div class="value">' + (stats.usersWarned || 0) + '</div></div>';
				html += '</div></div>';
			}
			
			// Empty State
			if (!bot.configured && allChats.length === 0) {
				html += '<div class="dash-section"><div class="dash-empty">';
				html += '<div class="icon-circle"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M7 21v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2"/></svg></div>';
				html += '<div class="dash-empty-title">Telegram Bot Not Configured</div>';
				html += '<div>Set <code>TELEGRAM_BOT_TOKEN</code> as a secret, then configure the webhook in <strong>Agents Config</strong>.</div>';
				html += '</div></div>';
			}
			
			html += '<div class="text-muted-xs" style="text-align:center;padding:12px 8px">Last updated: ' + new Date().toLocaleTimeString() + ' <button class="dash-btn btn-sm" style="margin-left:8px" onclick="loadDashboard(true)">Refresh</button></div>';
			html += '</div>';
			
			// ════════════ AGENTS CONFIG TAB (Bot Config + Chat Settings) ════════════
			html += '<div id="dashPanel-agentsconfig" class="dash-tab-panel' + (currentDashTab === 'agentsconfig' ? ' active' : '') + '">';
			
			if (!bot.configured) {
				html += '<div class="dash-empty">';
				html += '<div class="dash-empty-title">Bot not configured</div>';
				html += '<div>Set <code>TELEGRAM_BOT_TOKEN</code> to configure the bot.</div></div>';
			} else {
				html += '<div id="botConfigContent"><div class="dash-loading">Loading bot configuration...</div></div>';
			}
			
			// Chat Settings section (part of Agents Config)
			if (allChats.length > 0) {
				html += '<div class="chat-settings-section" style="margin-top:24px;padding-top:24px;border-top:1px solid var(--border-subtle)">';
				html += '<h2>Chat Settings</h2>';
				html += '<p class="section-desc">Configure per-chat settings: agent, moderation, proactive mode, channel posting.</p>';
				html += '<div class="chat-select-bar">';
				html += '<label>Configure chat:</label>';
				html += '<select class="setting-select" id="settingsChatSelect" onchange="loadChatSettings(this.value)" style="min-width:200px">';
				allChats.forEach(chat => {
					const chatId = chat.chatId || chat.id;
					html += '<option value="' + chatId + '">' + escapeHtml(chat.title || 'Chat ' + chatId) + ' (' + chat.type + ')</option>';
				});
				html += '</select>';
				html += '<button class="dash-btn" onclick="loadChatSettings(document.getElementById(\\'settingsChatSelect\\').value)">Load</button>';
				html += '</div>';
				html += '<div id="settingsContent"><div class="dash-loading">Select a chat to configure...</div></div>';
				html += '</div>';
			} else if (bot.configured) {
				html += '<div class="chat-settings-section" style="margin-top:24px;padding-top:24px;border-top:1px solid var(--border-subtle)">';
				html += '<h2>Chat Settings</h2>';
				html += '<div class="dash-empty" style="padding:24px">';
				html += '<div class="dash-empty-title">No chats found</div>';
				html += '<div>Add the bot to a channel or group first, then configure settings here.</div></div>';
				html += '</div>';
			}
			
			html += '</div>';
			
			// ════════════ TASKS (KANBAN) TAB ════════════
			html += '<div id="dashPanel-tasks" class="dash-tab-panel' + (currentDashTab === 'tasks' ? ' active' : '') + '">';
			html += '<div id="tasksContent"><div class="dash-loading">Loading tasks...</div></div>';
			html += '</div>';
			
			container.innerHTML = html;
			
			// Auto-load first chat settings + webhook info + bot config
			if (allChats.length > 0) {
				const firstChatId = allChats[0].chatId || allChats[0].id;
				loadChatSettings(firstChatId);
			}
			if (currentDashTab === 'agentsconfig') {
				loadBotConfig();
			}
		}
		
		// ── Tab switching ──
		window.switchDashTab = function(tabId) {
			currentDashTab = tabId;
			document.querySelectorAll('.dash-tab-btn').forEach(btn => {
				const text = btn.textContent.toLowerCase();
				const match = tabId === 'overview' ? text.includes('overview')
					: tabId === 'agentsconfig' ? text.includes('agents config')
					: tabId === 'tasks' ? text.includes('tasks')
					: false;
				btn.classList.toggle('active', match);
			});
			document.querySelectorAll('.dash-tab-panel').forEach(panel => {
				panel.classList.toggle('active', panel.id === 'dashPanel-' + tabId);
			});
			
			// Scroll dashboard to top on tab switch
			const dashEl = document.querySelector('.dashboard');
			if (dashEl) dashEl.scrollTop = 0;
			
			// Load data when switching to tabs
			if (tabId === 'agentsconfig') {
				loadBotConfig();
				const chats = dashboardData ? [...(dashboardData.channels || []), ...(dashboardData.groups || [])] : [];
				if (chats.length > 0 && selectedChatId) loadChatSettings(selectedChatId);
			}
			if (tabId === 'tasks') loadTaskBoard();
		};
		
		// ═══════════════════════════════════════════════
		// Bot Config Tab
		// ═══════════════════════════════════════════════
		
		let botConfigData = null;
		
		async function loadBotConfig() {
			const container = document.getElementById('botConfigContent');
			if (!container) return;
			
			if (!botConfigData) {
				container.innerHTML = '<div class="dash-loading">Loading bot configuration...</div>';
			}
			
			try {
				const [botRes, setupRes] = await Promise.all([
					authFetch('/api/dashboard/bot-settings', { signal: AbortSignal.timeout(10000) }),
					authFetch('/api/dashboard/setup', { signal: AbortSignal.timeout(10000) }),
				]);
				if (!botRes.ok) throw new Error('Status ' + botRes.status);
				botConfigData = await botRes.json();
				if (setupRes.ok) {
					const setupData = await setupRes.json();
					setupRoles = setupData.roles || [];
					botConfigData._setupComplete = setupData.setupComplete;
				}
				renderBotConfig(botConfigData);
				// Load custom prompts after UI is rendered
				if (window.loadPostPrompts) window.loadPostPrompts();
			} catch (error) {
				if (error.message === 'AUTH_REQUIRED') return;
				if (!botConfigData) {
					container.innerHTML = '<div class="dash-empty">Failed to load bot configuration: ' + error.message + '</div>';
				}
			}
		}
		
		function renderBotConfig(data) {
			const container = document.getElementById('botConfigContent');
			if (!container) return;
			
			const bot = data.bot || {};
			const commands = data.commands || [];
			const savedProfile = data.savedProfile || {};
			const kb = savedProfile.knowledgeBase || {};
			
			let html = '';
			
			// ═══════════════════════════════════════
			// SECTION 1: Bot Identity (first block)
			// ═══════════════════════════════════════
			html += '<div class="settings-group">';
			html += '<div class="bot-identity-header">';
			html += '<div class="bot-avatar">' + escapeHtml((bot.first_name || 'B').charAt(0)) + '</div>';
			html += '<div class="bot-identity-info">';
			html += '<div class="bot-identity-name">' + escapeHtml(bot.first_name || 'Bot') + '</div>';
			html += '<div class="bot-identity-username">@' + escapeHtml(bot.username || '—') + ' &middot; ID: ' + (bot.id || '—') + '</div>';
			html += '</div>';
			html += '<div class="flex-row" style="gap:4px;flex-wrap:wrap">';
			if (bot.can_join_groups) html += '<span class="badge badge-green">Groups</span>';
			if (bot.can_read_all_group_messages) html += '<span class="badge badge-blue">All msgs</span>';
			if (bot.supports_inline_queries) html += '<span class="badge badge-blue">Inline</span>';
			html += '</div>';
			html += '</div>';
			
			html += '<div class="setting-row" style="margin-top:12px">';
			html += '<div class="setting-label">Display Name<small>Editable — this is the name users see in Telegram chats</small></div>';
			html += '<div class="flex-row">';
			html += '<input type="text" class="setting-input setting-input-wide" id="botName" value="' + escapeHtml(bot.first_name || '') + '" maxlength="64"/>';
			html += '<button class="dash-btn dash-btn-primary btn-sm" onclick="saveBotName()">Save</button>';
			html += '</div></div>';
			
			html += '<div class="section-block" style="margin-top:12px">';
			html += '<div class="label-upper">Description</div>';
			html += '<textarea class="setting-textarea" id="botDescription" rows="2" placeholder="Describe what this bot does..." maxlength="512">' + escapeHtml(data.description || '') + '</textarea>';
			html += '</div>';
			
			html += '<div class="section-block">';
			html += '<div class="label-upper">Short Description</div>';
			html += '<textarea class="setting-textarea" id="botShortDescription" rows="1" placeholder="Brief summary for search results..." maxlength="120">' + escapeHtml(data.shortDescription || '') + '</textarea>';
			html += '</div>';
			
			html += '<button class="dash-btn dash-btn-primary" onclick="saveBotDescriptions()">Save Descriptions</button>';
			html += '</div>';
			
			// ═══════════════════════════════════════
			// SECTION 2: Bot Roles
			// ═══════════════════════════════════════
			const roles = [
				{ id: 'content', title: 'Content Manager', desc: 'Posts, scheduling, AI content' },
				{ id: 'moderator', title: 'Moderator', desc: 'Spam, scam, hate speech protection' },
				{ id: 'support', title: 'Support Agent', desc: 'Auto-answers, mentions, proactive help' },
			];
			
			html += '<div class="settings-group">';
			html += '<h3>Bot Roles</h3>';
			html += '<p class="section-desc">Active roles determine which features are enabled and which tasks appear on the board.</p>';
			
			html += '<div class="role-cards">';
			roles.forEach(function(role) {
				const selected = setupRoles.includes(role.id);
				html += '<div class="role-card' + (selected ? ' selected' : '') + '" onclick="toggleSetupRole(\\'' + role.id + '\\')" data-role="' + role.id + '">';
				html += '<div class="role-title">' + role.title + '</div>';
				html += '<div class="role-desc">' + role.desc + '</div>';
				html += '<div class="role-check">Active</div>';
				html += '</div>';
			});
			html += '</div>';
			
			if (data._setupComplete && setupRoles.length > 0) {
				html += '<div class="text-tertiary-sm" style="margin-top:4px">Active: ' + setupRoles.map(function(r) { return roles.find(function(x) { return x.id === r; })?.title; }).join(', ') + '</div>';
			}
			
			html += '<div style="margin-top:12px"><button class="dash-btn dash-btn-primary" id="setupSaveBtn" onclick="saveSetup()">Save Roles</button></div>';
			html += '</div>';
			
			// ═══════════════════════════════════════
			// SECTION 3: Personality & Behavior
			// ═══════════════════════════════════════
			html += '<div class="settings-group">';
			html += '<h3>Personality & Behavior</h3>';
			html += '<p class="section-desc">How the bot reacts and presents itself. Use {{userName}} in welcome message for the user\\'s name.</p>';
			
			html += '<div class="section-block">';
			html += '<div class="label-upper">Welcome Message</div>';
			html += '<textarea class="setting-textarea" id="botWelcome" rows="3" placeholder="Custom welcome message for /start command...">' + escapeHtml(savedProfile.welcomeMessage || '') + '</textarea>';
			html += '<div class="hint-text">Sent when a user starts a conversation. Leave empty for default.</div>';
			html += '</div>';
			
			html += '<div class="setting-row">';
			html += '<div class="setting-label">Personality / Tone<small>How the bot responds in conversations</small></div>';
			html += '<select class="setting-select" id="botPersonality">';
			const personalityOpts = [
				{ value: 'neutral', label: 'Neutral' },
				{ value: 'friendly', label: 'Friendly' },
				{ value: 'professional', label: 'Professional' },
				{ value: 'sarcastic', label: 'Sarcastic' },
				{ value: 'helpful', label: 'Helpful' },
			];
			personalityOpts.forEach(function(opt) {
				const sel = (savedProfile.personality || 'neutral') === opt.value ? ' selected' : '';
				html += '<option value="' + opt.value + '"' + sel + '>' + opt.label + '</option>';
			});
			html += '</select>';
			html += '</div>';
			
			html += '<div class="setting-row">';
			html += '<div class="setting-label">Default Agent<small>Agent used for new chats</small></div>';
			html += '<select class="setting-select" id="botDefaultAgent">';
			const agentsList = AGENTS || [];
			agentsList.forEach(a => {
				const selected = savedProfile.defaultAgent === a.id ? ' selected' : '';
				html += '<option value="' + a.id + '"' + selected + '>' + escapeHtml(a.name) + '</option>';
			});
			html += '</select>';
			html += '</div>';
			
			html += '<div class="setting-row">';
			html += '<div class="setting-label">Max History<small>Messages included as context</small></div>';
			html += '<input type="number" class="setting-input" id="botMaxHistory" min="2" max="100" value="' + (savedProfile.maxHistoryMessages || 30) + '"/>';
			html += '</div>';
			
			html += '<div class="setting-row">';
			html += '<div class="setting-label">Log Chat ID<small>Where activity logs are sent</small></div>';
			html += '<input type="text" class="setting-input setting-input-wide" id="botLogChat" value="' + escapeHtml(savedProfile.logChatId || '') + '" placeholder="-100..."/>';
			html += '</div>';
			
			html += '<div style="margin-top:12px"><button class="dash-btn dash-btn-primary" onclick="saveBotProfile()">Save Behavior</button></div>';
			html += '</div>';
			
			// ═══════════════════════════════════════
			// SECTION 4: Knowledge Base
			// ═══════════════════════════════════════
			html += '<div class="settings-group">';
			html += '<h3>Knowledge Base</h3>';
			html += '<p class="section-desc">Link your product website, docs, or other resources so the bot can reference them when answering questions.</p>';
			
			// Quick Setup card — pre-fills everything including KB
			html += '<div class="template-cards" style="margin-bottom:16px">';
			html += '<div class="template-card" onclick="applyTemplate(\\'nullshot\\')">';
			html += '<div class="template-icon" style="background:linear-gradient(135deg,#00d4aa,#14b8a6);color:#fff;font-weight:700">N</div>';
			html += '<div class="template-info">';
			html += '<div class="template-title">Nullshot AI — Quick Setup</div>';
			html += '<div class="template-desc">One click: fills knowledge base, roles, name, descriptions, welcome & personality</div>';
			html += '</div>';
			html += '<div class="template-apply">Apply</div>';
			html += '</div>';
			html += '</div>';
			
			html += '<div class="section-block">';
			html += '<div class="label-upper">Website URL</div>';
			html += '<input type="url" class="setting-input input-wide" id="kbWebsite" value="' + escapeHtml(kb.websiteUrl || '') + '" placeholder="https://yourproduct.com"/>';
			html += '<div class="hint-text">Main product or company website</div>';
			html += '</div>';
			
			html += '<div class="section-block">';
			html += '<div class="label-upper">Documentation URL</div>';
			html += '<input type="url" class="setting-input input-wide" id="kbDocs" value="' + escapeHtml(kb.docsUrl || '') + '" placeholder="https://docs.yourproduct.com"/>';
			html += '<div class="hint-text">API docs, help center, or knowledge base</div>';
			html += '</div>';
			
			html += '<div class="section-block">';
			html += '<div class="label-upper">Additional Links</div>';
			html += '<input type="text" class="setting-input input-wide" id="kbLinks" value="' + escapeHtml(kb.additionalLinks || '') + '" placeholder="https://blog.example.com, https://faq.example.com"/>';
			html += '<div class="hint-text">Comma-separated URLs (blog, FAQ, pricing, etc.)</div>';
			html += '</div>';
			
			html += '<div class="section-block">';
			html += '<div class="label-upper">Custom Instructions</div>';
			html += '<textarea class="setting-textarea" id="kbInstructions" rows="4" placeholder="Add product-specific info the bot should know:\\n- Key features and pricing\\n- Common customer issues\\n- Company policies and tone of voice...">' + escapeHtml(kb.instructions || '') + '</textarea>';
			html += '<div class="hint-text">Custom context injected into every conversation. The bot will use this to answer questions accurately.</div>';
			html += '</div>';
			
			html += '<button class="dash-btn dash-btn-primary" onclick="saveKnowledgeBase()">Save Knowledge Base</button>';
			html += '</div>';
			
			// ═══════════════════════════════════════
			// SECTION 4.5: System Prompts for Posts
			// ═══════════════════════════════════════
			html += '<div class="settings-group">';
			html += '<h3>Post System Prompts</h3>';
			html += '<p class="section-desc">Customize the AI instructions used when generating posts. Leave empty to use the built-in defaults. Changes apply to autopilot and manual post creation.</p>';
			
			const promptFormats = [
				{ id: 'text', label: 'Text Posts', desc: 'Plain text posts for news, opinions, insights' },
				{ id: 'photo', label: 'Image Posts', desc: 'Posts with AI-generated images (caption + imagePrompt)' },
				{ id: 'poll', label: 'Polls', desc: 'Interactive Telegram polls' },
				{ id: 'voice', label: 'Voice Posts', desc: 'Text-to-speech voice messages' },
			];
			
			promptFormats.forEach(pf => {
				html += '<div style="margin-bottom:16px">';
				html += '<div class="label-upper" style="margin-bottom:4px;display:flex;align-items:center;gap:8px">' + pf.label;
				html += '<span id="promptBadge_' + pf.id + '" class="badge badge-gray" style="font-size:10px">default</span>';
				html += '</div>';
				html += '<div class="hint-text" style="margin-bottom:6px">' + pf.desc + '</div>';
				html += '<textarea class="setting-textarea" id="prompt_' + pf.id + '" rows="4" placeholder="Leave empty for default prompt..." style="font-size:12px;font-family:monospace"></textarea>';
				html += '<div style="margin-top:4px;display:flex;gap:6px">';
				html += '<button class="dash-btn" style="font-size:11px;padding:4px 10px" onclick="savePostPrompt(\\'' + pf.id + '\\')">Save</button>';
				html += '<button class="dash-btn" style="font-size:11px;padding:4px 10px" onclick="resetPostPrompt(\\'' + pf.id + '\\')">Reset to Default</button>';
				html += '<button class="dash-btn" style="font-size:11px;padding:4px 10px" onclick="showDefaultPrompt(\\'' + pf.id + '\\')">View Default</button>';
				html += '</div>';
				html += '</div>';
			});
			
			html += '</div>';
			
			// ═══════════════════════════════════════
			// SECTION 5: Commands
			// ═══════════════════════════════════════
			html += '<div class="settings-group">';
			html += '<h3>Commands</h3>';
			html += '<p class="section-desc">Menu commands shown when users type /. Lowercase, 1-32 chars.</p>';
			
			html += '<div id="commandsList">';
			if (commands.length > 0) {
				commands.forEach((cmd, i) => {
					html += renderCommandRow(i, cmd.command, cmd.description);
				});
			} else {
				html += renderCommandRow(0, '', '');
			}
			html += '</div>';
			
			html += '<div class="flex-row" style="margin-top:12px">';
			html += '<button class="dash-btn" onclick="addCommandRow()">+ Add</button>';
			html += '<button class="dash-btn dash-btn-primary" onclick="saveBotCommands()">Save Commands</button>';
			html += '<button class="dash-btn btn-danger-outline" onclick="clearBotCommands()">Clear All</button>';
			html += '</div>';
			html += '</div>';
			
			
			// ═══════════════════════════════════════
			// SECTION 7: Menu Button (compact info)
			// ═══════════════════════════════════════
			const menuBtn = data.menuButton || {};
			if (menuBtn.type && menuBtn.type !== 'default') {
				html += '<div class="settings-group">';
				html += '<h3>Menu Button</h3>';
				html += '<div class="setting-row"><div class="setting-label">Type</div><div><span class="badge badge-gray">' + escapeHtml(menuBtn.type) + '</span></div></div>';
				if (menuBtn.text) {
					html += '<div class="setting-row"><div class="setting-label">Text</div><div>' + escapeHtml(menuBtn.text) + '</div></div>';
				}
				if (menuBtn.web_app?.url) {
					html += '<div class="setting-row"><div class="setting-label">Web App URL</div><div class="mono-val break-word">' + escapeHtml(menuBtn.web_app.url) + '</div></div>';
				}
				html += '</div>';
			}
			
			// ═══════════════════════════════════════
			// SECTION 8: Webhook Configuration
			// ═══════════════════════════════════════
			html += '<div class="settings-group">';
			html += '<h3>Webhook Configuration</h3>';
			html += '<p class="section-desc">Set or update the Telegram Bot webhook URL. The webhook tells Telegram where to send updates.</p>';
			html += '<div class="section-block">';
			html += '<div class="label-upper">Current Status</div>';
			html += '<div id="webhookStatus"><div class="dash-loading" style="padding:16px">Loading webhook info...</div></div>';
			html += '</div>';
			html += '<div class="section-block" style="margin-top:12px">';
			html += '<div class="label-upper">Set Webhook</div>';
			html += '<div class="webhook-url-box">';
			html += '<input type="text" id="webhookUrlInput" placeholder="https://your-worker.workers.dev/telegram/webhook" />';
			html += '<button class="dash-btn dash-btn-primary" onclick="setWebhook()">Set Webhook</button>';
			html += '</div>';
			html += '<div style="margin-top:8px"><button class="dash-btn" onclick="setWebhookAuto()">Auto-detect URL</button>';
			html += '<span class="text-muted-xs" style="margin-left:8px">Uses current worker URL</span></div>';
			html += '</div>';
			html += '</div>';
			
			container.innerHTML = html;
			
			// Load webhook info after rendering (element webhookStatus now exists)
			loadWebhookInfo();
		}
		
		function renderCommandRow(index, command, description) {
			return '<div class="setting-row" data-cmd-row="' + index + '">' +
				'<input type="text" class="setting-input setting-input-cmd" placeholder="command" value="' + escapeHtml(command || '') + '" data-cmd-name="' + index + '"/>' +
				'<input type="text" class="setting-input setting-input-flex" placeholder="Description" value="' + escapeHtml(description || '') + '" data-cmd-desc="' + index + '"/>' +
				'<button class="dash-btn btn-icon btn-danger-outline" onclick="this.closest(\\'.setting-row\\').remove()">&times;</button>' +
				'</div>';
		}
		
		window.addCommandRow = function() {
			const list = document.getElementById('commandsList');
			if (!list) return;
			const rows = list.querySelectorAll('[data-cmd-row]');
			const nextIdx = rows.length;
			const div = document.createElement('div');
			div.innerHTML = renderCommandRow(nextIdx, '', '');
			list.appendChild(div.firstChild);
		};
		
		// ── Save Bot Name ──
		window.saveBotName = async function() {
			const name = document.getElementById('botName')?.value;
			if (!name) return showToast('Name is required', true);
			try {
				const res = await authFetch('/api/dashboard/bot-settings/name', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name }),
				});
				const data = await res.json();
				if (data.success) {
					showToast('Bot name updated');
				} else {
					showToast(data.error || 'Failed', true);
				}
			} catch (err) {
				showToast('Failed: ' + err.message, true);
			}
		};
		
		// ── Save Bot Descriptions ──
		window.saveBotDescriptions = async function() {
			try {
				const desc = document.getElementById('botDescription')?.value || '';
				const shortDesc = document.getElementById('botShortDescription')?.value || '';
				
				const results = await Promise.all([
					authFetch('/api/dashboard/bot-settings/description', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ description: desc }),
					}),
					authFetch('/api/dashboard/bot-settings/short-description', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ shortDescription: shortDesc }),
					}),
				]);
				
				const allOk = results.every(r => r.ok);
				if (allOk) {
					showToast('Descriptions updated');
				} else {
					const errors = await Promise.all(results.filter(r => !r.ok).map(r => r.json()));
					showToast(errors[0]?.error || 'Failed to update', true);
				}
			} catch (err) {
				showToast('Failed: ' + err.message, true);
			}
		};
		
		// ── Save Bot Commands ──
		window.saveBotCommands = async function() {
			try {
				const rows = document.querySelectorAll('[data-cmd-row]');
				const commands = [];
				rows.forEach(row => {
					const nameInput = row.querySelector('[data-cmd-name]');
					const descInput = row.querySelector('[data-cmd-desc]');
					const cmd = nameInput?.value?.trim();
					const desc = descInput?.value?.trim();
					if (cmd && desc) {
						commands.push({ command: cmd, description: desc });
					}
				});
				
				if (commands.length === 0) return showToast('Add at least one command', true);
				
				const res = await authFetch('/api/dashboard/bot-settings/commands', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ commands }),
				});
				const data = await res.json();
				if (data.success) {
					showToast('Commands updated (' + (data.commands?.length || 0) + ' commands)');
				} else {
					showToast(data.error || 'Failed', true);
				}
			} catch (err) {
				showToast('Failed: ' + err.message, true);
			}
		};
		
		// ── Clear Bot Commands ──
		window.clearBotCommands = async function() {
			if (!confirm('Remove all bot commands? Users will no longer see the command menu.')) return;
			try {
				const res = await authFetch('/api/dashboard/bot-settings/commands', { method: 'DELETE' });
				const data = await res.json();
				if (data.success) {
					showToast('All commands cleared');
					loadBotConfig();
				} else {
					showToast(data.error || 'Failed', true);
				}
			} catch (err) {
				showToast('Failed: ' + err.message, true);
			}
		};
		
		// ── Save Bot Profile (behavior settings) ──
		window.saveBotProfile = async function() {
			try {
				const payload = {
					welcomeMessage: document.getElementById('botWelcome')?.value || '',
					personality: document.getElementById('botPersonality')?.value || 'neutral',
					logChatId: document.getElementById('botLogChat')?.value || '',
					defaultAgent: document.getElementById('botDefaultAgent')?.value || '',
					maxHistoryMessages: parseInt(document.getElementById('botMaxHistory')?.value || '30'),
				};
				const res = await authFetch('/api/dashboard/bot-settings/profile', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
				const data = await res.json();
				if (data.success) {
					showToast('Bot behavior settings saved');
				} else {
					showToast(data.error || 'Failed', true);
				}
			} catch (err) {
				showToast('Failed: ' + err.message, true);
			}
		};
		
		// ── Apply Template ──
		window.applyTemplate = async function(templateId) {
			const templates = {
				nullshot: {
					roles: ['content', 'moderator', 'support'],
					name: 'Nullshot AI',
					personality: 'friendly',
					welcomeMessage: 'Hey! I\\'m Nullshot AI — your assistant for the Nullshot platform. Ask me about building agents, launching products, $XAVA, or anything else. Let\\'s build together!',
					description: 'Nullshot AI assistant — answers questions about the platform, helps with agent building, manages community, and publishes content.',
					shortDescription: 'Nullshot AI: build together, launch together',
					knowledgeBase: {
						websiteUrl: 'https://nullshot.ai',
						docsUrl: 'https://nullshot.ai/en/docs/getting-started/quickstart',
						additionalLinks: 'https://nullshot.ai/en/docs/developers/agents-framework/overview, https://nullshot.ai/products, https://nullshot.ai/brainstorm, https://blog.avalaunch.app/the-xava-ecosystem-avalaunch-xava-labs-and-nullshot/',
						instructions: 'You are the Nullshot AI assistant — the official bot for the Nullshot platform (nullshot.ai).\\n\\n═══ ABOUT NULLSHOT ═══\\nNullshot is an AI-powered co-creation platform with the mission: "Build Together, Launch Together."\\nLaunched in October 2025, it evolved from Avalaunch — the proven Avalanche-native launchpad (operating since 2021, 30+ project launches, $23M raised, 400k+ IDO participants).\\n\\nNullshot enables communities of developers, entrepreneurs, and non-technical creators to collaboratively build, own, and launch AI Agents, Tools, and Applications — with every contribution tracked and credited for future ownership distribution.\\n\\n═══ CORE FEATURES ═══\\n1. Brainstorms — chat rooms where users brainstorm ideas, propose features, vote on directions, and develop projects together. Every contribution is tracked.\\n2. AI Agent Builder — a lightweight toolkit for creating AI agents locally or in the cloud, no coding required. Build agents that can chat, use tools, manage tasks, moderate communities.\\n3. Product Remixing — take existing applications and customize them with new features, integrations, or monetization layers.\\n4. Product Showcase — browse and discover community-built products, agents, and tools.\\n5. Jams — collaborative building sessions where the community comes together to ship products.\\n6. Origination Pools — future tokenization of launched products for shared ownership, staking-based rewards, and community governance.\\n\\n═══ DEVELOPER TOOLS & FRAMEWORKS ═══\\nNullshot provides a full developer stack for building AI agents:\\n\\n• Agents Framework — build stateful AI agents on Cloudflare Workers with Durable Objects, WebSocket support, session management, and streaming responses. Supports multiple AI providers (OpenAI, Anthropic, Google, DeepSeek, xAI, Workers AI).\\n• MCP Framework — build Model Context Protocol (MCP) servers on Cloudflare Workers. MCP is a standard for connecting AI models to external tools and data sources.\\n• CLI (nullshot CLI) — scaffold new projects, install MCP servers, bundle and deploy agents with one command.\\n• Playground — web-based UI for testing agents interactively with chat, tool visualization, and dashboard tabs.\\n• Toolbox Service — auto-discovers and connects MCP tool servers to agents (zero config in single-worker mode).\\n• Integrations: Vercel AI SDK, ElizaOS, Grammy (Telegram bots).\\n\\nGetting started: npx @nullshot/cli create my-agent\\nDocs: https://nullshot.ai/en/docs/developers/overview\\n\\n═══ THE XAVA ECOSYSTEM ═══\\nNullshot is part of a three-layer ecosystem powered by the $XAVA token:\\n\\nLayer 1 — $XAVA Token (Foundation):\\n- Multi-utility token that powers the entire ecosystem\\n- Governs Nullshot platform decisions\\n- Earns a share of successfully launched product tokens\\n- Primary trading pair on the platform\\n- Will power transactions on the planned L1 blockchain\\n- Gains new utility layers as the ecosystem expands\\n\\nLayer 2 — Products (Where Users Interact):\\n- Avalaunch — proven launchpad since 2021, 30+ launches, fully operational\\n- Nullshot — AI-powered co-creation platform (flagship product)\\n- Future products in active development\\n\\nLayer 3 — XAVA Labs (The Engine):\\n- R&D initiative building all products\\n- Research-driven development: identify genuine needs → develop solutions → integrate XAVA utility → ship\\n- Current portfolio: Avalaunch, TypeScript Agent Framework, Nullshot, active research pipeline\\n\\nAvalaunch vs Nullshot:\\n- Avalaunch = "support promising projects by investing" (community as investors)\\n- Nullshot = "build promising projects by contributing" (community as builders)\\n- They complement each other. Both serve the XAVA ecosystem. Both create utility for $XAVA.\\n\\n═══ NOTABLE COMMUNITY PROJECTS ═══\\nProjects being built on Nullshot include: CoinCub, SkillBridge AI, VeriVerse, Genesis MCP, Axohub, NullBridge MCP, AetheraOS, Agent Memory Vault, Null Notebook, Skill Path, and many more.\\n\\n═══ COMMUNITY & LINKS ═══\\n- Website: https://nullshot.ai\\n- Docs: https://nullshot.ai/en/docs\\n- Products: https://nullshot.ai/products\\n- Brainstorms: https://nullshot.ai/brainstorm\\n- Discord, GitHub, Twitter (@nullaborators), Telegram\\n\\n═══ BEHAVIOR GUIDELINES ═══\\n- Be helpful, friendly, and enthusiastic about building\\n- Answer concisely (2-5 sentences) unless the user asks for detail\\n- Always match the language the user writes in (Russian, English, etc.)\\n- When asked about something you don\\'t know, say so honestly and point to docs or community channels\\n- Encourage users to brainstorm ideas and start building\\n- For technical questions, reference the developer docs and frameworks\\n- For token/investment questions, share factual info but never give financial advice',
					},
				},
			};
			
			const tpl = templates[templateId];
			if (!tpl) return;
			
			if (!confirm('Apply Nullshot AI preset? This will configure your bot with all roles, descriptions, welcome message, and knowledge base.')) return;
			
			try {
				// Apply all roles (content + moderator + support)
				setupRoles = tpl.roles;
				await authFetch('/api/dashboard/setup', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ roles: setupRoles }),
				});
				
				// Apply bot display name
				await authFetch('/api/dashboard/bot-settings/name', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: tpl.name }),
				});
				
				// Apply welcome message and personality
				await authFetch('/api/dashboard/bot-settings/profile', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						welcomeMessage: tpl.welcomeMessage,
						personality: tpl.personality || 'neutral',
					}),
				});
				
				// Apply descriptions
				await authFetch('/api/dashboard/bot-settings/description', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ description: tpl.description }),
				});
				await authFetch('/api/dashboard/bot-settings/short-description', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ shortDescription: tpl.shortDescription }),
				});
				
				// Apply knowledge base
				if (tpl.knowledgeBase) {
					await authFetch('/api/dashboard/bot-settings/profile', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ knowledgeBase: tpl.knowledgeBase }),
					});
				}
				
				showToast('Nullshot AI preset applied! Reloading config...');
				loadBotConfig();
			} catch (err) {
				showToast('Failed to apply preset: ' + err.message, true);
			}
		};
		
		// ── Save Knowledge Base ──
		window.saveKnowledgeBase = async function() {
			try {
				const payload = {
					knowledgeBase: {
						websiteUrl: document.getElementById('kbWebsite')?.value || '',
						docsUrl: document.getElementById('kbDocs')?.value || '',
						additionalLinks: document.getElementById('kbLinks')?.value || '',
						instructions: document.getElementById('kbInstructions')?.value || '',
					},
				};
				const res = await authFetch('/api/dashboard/bot-settings/profile', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
				const data = await res.json();
				if (data.success) {
					showToast('Knowledge base saved');
				} else {
					showToast(data.error || 'Failed', true);
				}
			} catch (err) {
				showToast('Failed: ' + err.message, true);
			}
		};
		
		// ── Post System Prompts ──
		let cachedDefaultPrompts = {};
		
		window.loadPostPrompts = async function() {
			try {
				const res = await authFetch('/api/dashboard/bot-settings/prompts');
				if (!res.ok) return;
				const data = await res.json();
				if (!data.prompts) return;
				
				for (const [fmt, info] of Object.entries(data.prompts)) {
					cachedDefaultPrompts[fmt] = info.default || '';
					const textarea = document.getElementById('prompt_' + fmt);
					const badge = document.getElementById('promptBadge_' + fmt);
					if (textarea) textarea.value = info.custom || '';
					if (badge) {
						badge.textContent = info.isCustom ? 'custom' : 'default';
						badge.className = info.isCustom ? 'badge badge-blue' : 'badge badge-gray';
					}
				}
			} catch (err) {
				console.warn('Failed to load prompts:', err);
			}
		};
		
		window.savePostPrompt = async function(format) {
			const textarea = document.getElementById('prompt_' + format);
			if (!textarea) return;
			try {
				const res = await authFetch('/api/dashboard/bot-settings/prompts', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ format, prompt: textarea.value }),
				});
				if (!res.ok) throw new Error('Status ' + res.status);
				const data = await res.json();
				const badge = document.getElementById('promptBadge_' + format);
				if (badge) {
					badge.textContent = data.isCustom ? 'custom' : 'default';
					badge.className = data.isCustom ? 'badge badge-blue' : 'badge badge-gray';
				}
				showToast(data.isCustom ? 'Custom prompt saved' : 'Reset to default');
			} catch (err) {
				showToast('Failed to save prompt: ' + err.message, true);
			}
		};
		
		window.resetPostPrompt = async function(format) {
			const textarea = document.getElementById('prompt_' + format);
			if (textarea) textarea.value = '';
			await window.savePostPrompt(format);
		};
		
		window.showDefaultPrompt = function(format) {
			const textarea = document.getElementById('prompt_' + format);
			if (!textarea) return;
			const def = cachedDefaultPrompts[format] || '';
			if (textarea.value === def) {
				textarea.value = '';
				showToast('Cleared — showing placeholder');
			} else {
				textarea.value = def;
				showToast('Showing default prompt (not saved yet)');
			}
		};
		
		// ═══════════════════════════════════════════════
		// Setup Roles
		// ═══════════════════════════════════════════════
		
		let setupRoles = [];
		
		// Setup functions removed — role selection is now integrated into Bot Config tab
		
		window.toggleSetupRole = function(roleId) {
			const idx = setupRoles.indexOf(roleId);
			if (idx >= 0) {
				setupRoles.splice(idx, 1);
			} else {
				setupRoles.push(roleId);
			}
			
			// Update UI
			document.querySelectorAll('.role-card').forEach(function(card) {
				const rid = card.dataset.role;
				card.classList.toggle('selected', setupRoles.includes(rid));
			});
			
			const btn = document.getElementById('setupSaveBtn');
			if (btn) btn.classList.toggle('ready', setupRoles.length > 0);
		};
		
		window.saveSetup = async function() {
			if (setupRoles.length === 0) return showToast('Select at least one role', true);
			
			try {
				const res = await authFetch('/api/dashboard/setup', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ roles: setupRoles }),
				});
				const data = await res.json();
				if (data.success) {
					const msg = data.createdTasks && data.createdTasks.length > 0
						? 'Roles saved! Created ' + data.createdTasks.length + ' task(s) on the board.'
						: 'Roles saved!';
					showToast(msg);
					// Refresh bot config view
					loadBotConfig();
				} else {
					showToast(data.error || 'Failed', true);
				}
			} catch (err) {
				showToast('Failed: ' + err.message, true);
			}
		};
		
		// ═══════════════════════════════════════════════
		// Kanban Task Board
		// ═══════════════════════════════════════════════
		
		let kanbanData = null;
		let selectedTask = null;
		
		async function loadTaskBoard() {
			const container = document.getElementById('tasksContent');
			if (!container) return;
			
			try {
				const res = await authFetch('/api/dashboard/tasks');
				if (!res.ok) throw new Error('Status ' + res.status);
				kanbanData = await res.json();
				renderKanbanBoard(kanbanData);
			} catch (error) {
				if (error.message === 'AUTH_REQUIRED') return;
				container.innerHTML = '<div class="dash-empty">Failed to load tasks: ' + error.message + '</div>';
			}
		}
		
		function renderKanbanBoard(data) {
			const container = document.getElementById('tasksContent');
			if (!container) return;
			
			let html = '';
			
			// Actions bar
			html += '<div class="dash-actions">';
			html += '<button class="dash-btn dash-btn-primary" onclick="showCreatePostForm()">+ New Post</button>';
			html += '<button class="dash-btn" onclick="loadTaskBoard()">Refresh</button>';
			html += '<span class="text-muted-sm" style="margin-left:auto">' + data.totalTasks + ' task(s)</span>';
			html += '</div>';
			
			// Create post form (hidden by default, appears ABOVE the board)
			html += '<div id="createPostForm" style="display:none;margin-bottom:16px">';
			html += '<div class="dash-section">';
			html += '<h2>Create Post</h2>';
			
			// Target chats (checkboxes)
			html += '<div class="section-block">';
			html += '<div class="flex-between"><label class="field-label">Publish to</label>';
			html += '<label class="select-all-label"><input type="checkbox" id="postSelectAll" onchange="toggleAllPostTargets(this.checked)"/>Select all</label>';
			html += '</div>';
			html += '<div class="post-targets">';
			var postChats = (dashboardData && [...(dashboardData.channels || []), ...(dashboardData.groups || [])]) || [];
			if (postChats.length === 0) {
				html += '<div class="text-muted-sm" style="padding:8px">No channels or groups found. Add the bot to a chat first.</div>';
			} else {
				postChats.forEach(function(chat) {
					var chatId = chat.chatId || chat.id;
					var typeLabel = chat.type === 'channel' ? 'Channel' : 'Group';
					var canPost = chat.canPost !== false;
					html += '<label class="post-target-label' + (canPost ? '' : ' disabled') + '">';
					html += '<input type="checkbox" name="postTarget" value="' + chatId + '" data-title="' + escapeHtml(chat.title || 'Chat ' + chatId) + '"' + (canPost ? '' : ' disabled') + '/>';
					html += '<span class="badge ' + (chat.type === 'channel' ? 'badge-blue' : 'badge-gray') + ' badge-micro">' + typeLabel + '</span> ';
					html += escapeHtml(chat.title || 'Chat ' + chatId);
					if (!canPost) html += ' <span class="text-muted-xs">(no access)</span>';
					html += '</label>';
				});
			}
			html += '</div></div>';
			
			// Content mode: AI generate vs publish as-is
			html += '<div class="section-block">';
			html += '<div class="flex-between" style="margin-bottom:8px">';
			html += '<div class="flex-row" style="align-items:center;gap:8px">';
			html += '<label class="field-label" style="margin-bottom:0">Post content</label>';
			html += '<button type="button" class="dash-btn" style="font-size:12px;padding:4px 10px" onclick="showTemplatePopup()">Template</button>';
			html += '<button type="button" class="dash-btn" style="font-size:12px;padding:4px 10px" onclick="showPostPreview()">Preview</button>';
			html += '</div>';
			html += '<div class="flex-row" style="gap:16px;flex-wrap:wrap">';
			html += '<label class="schedule-option" style="font-size:12px"><input type="checkbox" id="postGenerateAI" checked onchange="updateContentPlaceholder()"/> Generate with AI</label>';
			html += '</div></div>';
			html += '<div style="margin-bottom:8px"><label class="field-label">Format</label>';
			html += '<select class="setting-select" id="postFormat" style="max-width:200px" onchange="updateAutoFormatHint()">';
			html += '<option value="auto">Auto (AI chooses)</option>';
			html += '<option value="text">Text only</option>';
			html += '<option value="photo">Photo + caption</option>';
			html += '<option value="voice">Voice message</option>';
			html += '<option value="poll">Poll</option>';
			html += '</select>';
			html += '<span class="text-muted-xs" style="margin-left:8px">Voice = TTS (EN,ES,FR,ZH,JA,KO). Poll = voting.</span>';
			html += '<div id="autoFormatHint" class="text-muted-xs" style="margin-top:4px;display:none">Recurring: AI rotates formats (text → voice → photo → poll) and builds a connected narrative across posts.</div></div>';
			html += '<textarea class="setting-textarea" id="postContent" rows="5" placeholder="Describe what to post about... e.g. &quot;AI meetup this Friday, link: https://...&quot;"></textarea>';
			html += '<div id="aiHint" class="text-muted-xs" style="margin-top:4px">AI will generate an engaging post based on your description and Knowledge Base.</div>';
			html += '<div id="rawHint" class="text-muted-xs" style="margin-top:4px;display:none">Text will be published exactly as written.</div>';
			html += '</div>';
			
			// Schedule type
			html += '<div class="section-block" id="scheduleTypeSection">';
			html += '<label class="field-label">When to publish</label>';
			html += '<div class="schedule-options" id="scheduleTypeOptions">';
			html += '<label class="schedule-option"><input type="radio" name="postScheduleType" value="now" checked onchange="updateScheduleUI()"/> Publish now</label>';
			html += '<label class="schedule-option"><input type="radio" name="postScheduleType" value="scheduled" onchange="updateScheduleUI()"/> Schedule for later</label>';
			html += '<label class="schedule-option"><input type="radio" name="postScheduleType" value="recurring" onchange="updateScheduleUI()"/> Autopilot / Recurring</label>';
			html += '</div>';
			// Scheduled: datetime picker
			html += '<div id="scheduleDateTime" style="display:none;margin-top:12px">';
			html += '<label class="field-label">Date & Time</label>';
			html += '<input type="datetime-local" class="setting-input input-wide" id="postScheduledAt"/>';
			html += '</div>';
			
			// Recurring: cron
			html += '<div id="scheduleCron" style="display:none;margin-top:12px">';
			html += '<div class="grid-2col">';
			html += '<div><label class="field-label">Frequency preset</label>';
			html += '<select class="setting-select input-wide" id="postCronPreset" onchange="updateCronFromPreset()">';
			html += '<optgroup label="Autopilot">';
			html += '<option value="* * * * *">Every minute</option>';
			html += '<option value="*/5 * * * *">Every 5 minutes</option>';
			html += '<option value="*/10 * * * *">Every 10 minutes</option>';
			html += '<option value="*/15 * * * *">Every 15 minutes</option>';
			html += '<option value="*/30 * * * *">Every 30 minutes</option>';
			html += '<option value="0 * * * *">Every hour</option>';
			html += '</optgroup>';
			html += '<optgroup label="Schedule">';
			html += '<option value="0 */2 * * *">Every 2 hours</option>';
			html += '<option value="0 */3 * * *">Every 3 hours</option>';
			html += '<option value="0 */6 * * *">Every 6 hours</option>';
			html += '<option value="0 10 * * *">Daily at 10:00</option>';
			html += '<option value="0 10,18 * * *">Twice daily (10:00 & 18:00)</option>';
			html += '<option value="0 9,13,18 * * *">Three times daily (9, 13, 18)</option>';
			html += '<option value="0 9 * * 1-5">Weekdays at 9:00</option>';
			html += '<option value="0 12 * * 1">Weekly (Mon 12:00)</option>';
			html += '<option value="0 10 1 * *">Monthly (1st at 10:00)</option>';
			html += '</optgroup>';
			html += '<optgroup label="Custom">';
			html += '<option value="">Custom cron...</option>';
			html += '</optgroup>';
			html += '</select></div>';
			html += '<div><label class="field-label">Cron expression</label>';
			html += '<input type="text" class="setting-input input-wide" id="postCronExpr" placeholder="0 10 * * *"/></div>';
			html += '</div>';
			html += '<div style="margin-top:8px"><label class="field-label">Timezone</label>';
			html += '<select class="setting-select" id="postTimezone" style="max-width:300px">';
			html += '<option value="">UTC (default)</option>';
			html += '<option value="Europe/Moscow">Moscow (MSK)</option>';
			html += '<option value="Europe/London">London (GMT/BST)</option>';
			html += '<option value="Europe/Berlin">Berlin (CET)</option>';
			html += '<option value="America/New_York">New York (EST)</option>';
			html += '<option value="America/Los_Angeles">Los Angeles (PST)</option>';
			html += '<option value="Asia/Tokyo">Tokyo (JST)</option>';
			html += '<option value="Asia/Dubai">Dubai (GST)</option>';
			html += '</select></div>';
			html += '<div class="text-muted-xs" style="margin-top:6px">Format: minute hour day month weekday (e.g. <code>0 10 * * 1-5</code> = weekdays at 10:00)</div>';
			html += '</div>';
			html += '</div>';
			
			// Auto-approve toggle
			html += '<div class="section-block highlight-box">';
			html += '<label class="schedule-option" style="font-weight:500">';
			html += '<input type="checkbox" id="postAutoApprove" checked/>';
			html += ' Auto-approve (publish automatically)';
			html += '</label>';
			html += '<div class="text-muted-xs auto-approve-hint">If unchecked — post goes to approval queue. Approve via Telegram bot or kanban board.</div>';
			html += '</div>';
			
			// Buttons
			html += '<div class="flex-row" style="margin-top:16px">';
			html += '<button class="dash-btn dash-btn-primary" onclick="createPost()">Create Post</button>';
			html += '<button class="dash-btn" onclick="document.getElementById(\\'createPostForm\\').style.display=\\'none\\'">Cancel</button>';
			html += '</div></div></div>';
			
			// Kanban columns
			html += '<div class="kanban-board">';
			
			// Column: Awaiting Approval
			if ((data.awaitingApproval || []).length > 0) {
				html += renderKanbanColumn('Awaiting Approval', data.awaitingApproval || []);
			}
			
			// Column: Queued
			html += renderKanbanColumn('Queued', data.queued || []);
			
			// Column: In Progress
			html += renderKanbanColumn('In Progress', data.inProgress || []);
			
			// Column: Done
			html += renderKanbanColumn('Done', (data.done || []).slice(0, 10));
			
			html += '</div>';
			
			// Task detail modal
			html += '<div class="task-modal-overlay" id="taskModalOverlay" aria-hidden="true" onclick="if(event.target===this)closeTaskModal()">';
			html += '<div class="task-modal" id="taskModalContent"></div>';
			html += '</div>';
			// Template popup
			html += '<div class="task-modal-overlay" id="templateModalOverlay" aria-hidden="true" style="display:none" onclick="if(event.target===this)closeTemplatePopup()">';
			html += '<div class="task-modal" id="templateModalContent" style="max-width:480px" onclick="event.stopPropagation()">';
			html += '<div class="flex-between section-block" style="align-items:start">';
			html += '<h3>Post template</h3>';
			html += '<button class="modal-close-btn" onclick="closeTemplatePopup()">&times;</button>';
			html += '</div>';
			html += '<div class="section-block">';
			html += '<div class="text-muted-xs" style="margin-bottom:12px">Click a template to insert into the post field:</div>';
			html += '<div id="templateExamplesList"></div>';
			html += '</div>';
			html += '</div></div>';
			// Preview popup (generated example from current topic)
			html += '<div class="task-modal-overlay" id="previewModalOverlay" aria-hidden="true" style="display:none" onclick="if(event.target===this)closePreviewPopup()">';
			html += '<div class="task-modal" id="previewModalContent" style="max-width:520px" onclick="event.stopPropagation()">';
			html += '<div class="flex-between section-block" style="align-items:start">';
			html += '<h3>Post preview</h3>';
			html += '<button class="modal-close-btn" onclick="closePreviewPopup()">&times;</button>';
			html += '</div>';
			html += '<div class="section-block">';
			html += '<div id="previewContent" class="post-preview-box" style="white-space:pre-wrap;padding:12px;background:var(--bg-subtle);border-radius:8px;max-height:300px;overflow-y:auto"></div>';
			html += '<div class="flex-row" style="margin-top:12px;gap:8px">';
			html += '<button class="dash-btn dash-btn-primary" onclick="usePreviewAsContent()">Use as content</button>';
			html += '<button class="dash-btn" onclick="closePreviewPopup()">Close</button>';
			html += '</div></div></div></div>';
			
			container.innerHTML = html;
		}
		
		function renderKanbanColumn(title, tasks) {
			let html = '<div class="kanban-col">';
			html += '<div class="kanban-col-header">';
			html += '<span class="kanban-col-title">' + title + '</span>';
			html += '<span class="kanban-col-count">' + tasks.length + '</span>';
			html += '</div>';
			
			html += '<div class="kanban-col-cards">';
			if (tasks.length === 0) {
				html += '<div class="kanban-empty">No tasks</div>';
			} else {
				tasks.forEach(function(task) {
					html += renderKanbanCard(task);
				});
			}
			html += '</div>';
			
			html += '</div>';
			return html;
		}
		
		function renderKanbanCard(task) {
			const roleClass = task.role ? ' role-' + task.role : '';
			const kindTag = task.kind === 'persistent' ? 'kanban-tag-persistent'
				: task.kind === 'recurring' ? 'kanban-tag-recurring'
				: 'kanban-tag-oneshot';
			
			let html = '<div class="kanban-card' + roleClass + '" onclick="openTaskDetail(\\'' + task.id + '\\')">';
			html += '<div class="kanban-card-title">' + escapeHtml(task.title) + '</div>';
			if (task.description) {
				html += '<div class="kanban-card-desc">' + escapeHtml(task.description) + '</div>';
			}
			html += '<div class="kanban-card-meta">';
			html += '<span class="kanban-tag ' + kindTag + '">' + task.kind + '</span>';
			
			// Show key stats inline
			const statKeys = Object.keys(task.stats || {});
			if (statKeys.length > 0) {
				const topStats = statKeys.slice(0, 2);
				topStats.forEach(function(key) {
					html += '<span class="kanban-stat">' + key + ': ' + task.stats[key] + '</span>';
				});
			}
			
			if (task.runCount > 0) {
				html += '<span class="kanban-stat">runs: ' + task.runCount + '</span>';
			}
			
			html += '</div></div>';
			return html;
		}
		
		window.showCreatePostForm = function() {
			const form = document.getElementById('createPostForm');
			if (form) {
				const isHidden = form.style.display === 'none';
				form.style.display = isHidden ? 'block' : 'none';
				if (isHidden) {
					// Set default datetime to 1 hour from now for scheduled
					const now = new Date(Date.now() + 3600000);
					const dtInput = document.getElementById('postScheduledAt');
					if (dtInput) {
						const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
						dtInput.value = local.toISOString().slice(0, 16);
					}
				}
			}
		};
		
		window.toggleAllPostTargets = function(checked) {
			document.querySelectorAll('input[name="postTarget"]').forEach(function(cb) {
				if (!cb.disabled) cb.checked = checked;
			});
		};
		
		window.updateScheduleUI = function() {
			const type = document.querySelector('input[name="postScheduleType"]:checked')?.value || 'now';
			const dtSection = document.getElementById('scheduleDateTime');
			const cronSection = document.getElementById('scheduleCron');
			if (dtSection) dtSection.style.display = type === 'scheduled' ? 'block' : 'none';
			if (cronSection) cronSection.style.display = type === 'recurring' ? 'block' : 'none';
			window.updateAutoFormatHint?.();
		};
		
		window.updateAutoFormatHint = function() {
			const fmt = document.getElementById('postFormat')?.value;
			const type = document.querySelector('input[name="postScheduleType"]:checked')?.value || 'now';
			const hint = document.getElementById('autoFormatHint');
			if (hint) hint.style.display = (fmt === 'auto' && type === 'recurring') ? 'block' : 'none';
		};

		window.updateCronFromPreset = function() {
			const preset = document.getElementById('postCronPreset')?.value;
			const cronInput = document.getElementById('postCronExpr');
			if (preset && cronInput) cronInput.value = preset;
		};
		
		window.updateContentPlaceholder = function() {
			const isAI = document.getElementById('postGenerateAI')?.checked;
			const textarea = document.getElementById('postContent');
			const aiHint = document.getElementById('aiHint');
			const rawHint = document.getElementById('rawHint');
			if (textarea) {
				textarea.placeholder = isAI
					? 'Describe what to post about... e.g. "AI meetup this Friday, link: https://..."'
					: 'Write the exact post text to publish...';
			}
			if (aiHint) aiHint.style.display = isAI ? 'block' : 'none';
			if (rawHint) rawHint.style.display = isAI ? 'none' : 'block';
		};
		var POST_TEMPLATES = [
			{ label: 'AI meetup with link', text: 'AI meetup this Friday 18:00. Topic: LLMs in production. Link: https://example.com/meetup' },
			{ label: 'SQLite fact', text: 'SQLite handles 2 trillion queries a day — more than Postgres, MySQL, and MongoDB combined. Short fact for the channel.' },
			{ label: 'Product launch', text: 'New feature release: real-time collaboration. Include benefits and a call to try it. Link: https://product.com/changelog' },
			{ label: 'Tech news', text: 'GitHub Copilot now writes 46% of new code. Brief take on what this means for developers.' },
			{ label: 'Event reminder', text: 'Webinar tomorrow at 15:00 UTC: Building with Workers AI. Registration: https://example.com/register' },
			{ label: 'Voice: daily tip', text: 'Daily productivity tip — one short actionable idea. Use voice format.', format: 'voice' },
			{ label: 'Poll: community vote', text: 'Which feature should we prioritize next? Options: API improvements, Mobile app, Integrations, Documentation.', format: 'poll' },
		];
		window._templateCache = [];
		window.showTemplatePopup = function() {
			const overlay = document.getElementById('templateModalOverlay');
			const list = document.getElementById('templateExamplesList');
			if (!overlay || !list) return;
			var customTemplates = [];
			try {
				var stored = localStorage.getItem('post-templates');
				if (stored) customTemplates = JSON.parse(stored);
			} catch (e) {}
			window._templateCache = POST_TEMPLATES.concat(customTemplates);
			var html = '';
			window._templateCache.forEach(function(t, i) {
				html += '<div class="template-item" style="padding:10px 12px;margin-bottom:8px;border-radius:8px;background:var(--accent-faint, #f0f9ff);cursor:pointer;border:1px solid var(--accent-subtle, #e0f2fe)" onclick="insertTemplateByIndex(' + i + ')">';
				html += '<div style="font-weight:500;margin-bottom:4px">' + escapeHtml(t.label) + '</div>';
				html += '<div class="text-muted-xs" style="font-size:11px;line-height:1.4">' + escapeHtml(t.text.length > 80 ? t.text.substring(0, 80) + '...' : t.text) + '</div>';
				html += '</div>';
			});
			list.innerHTML = html || '<div class="text-muted-xs">No templates</div>';
			overlay.style.display = '';
			overlay.classList.add('open');
			overlay.setAttribute('aria-hidden', 'false');
		};
		window.insertTemplateByIndex = function(idx) {
			var t = window._templateCache && window._templateCache[idx];
			if (!t) return;
			var textarea = document.getElementById('postContent');
			if (textarea) {
				textarea.value = t.text;
				textarea.focus();
			}
			if (t.format) {
				var formatSel = document.getElementById('postFormat');
				if (formatSel && ['voice','poll','text','photo','auto'].indexOf(t.format) >= 0) {
					formatSel.value = t.format;
				}
			}
			closeTemplatePopup();
		};
		window.closeTemplatePopup = function() {
			var overlay = document.getElementById('templateModalOverlay');
			if (overlay) {
				overlay.classList.remove('open');
				overlay.style.display = 'none';
				overlay.setAttribute('aria-hidden', 'true');
			}
		};
		window._lastPreviewContent = '';
		function formatPreviewContent(raw) {
			try {
				var m = raw.match(/\\{[\s\S]*\\}/);
				if (m) {
					var obj = JSON.parse(m[0]);
					if (obj.type === 'voice') {
						return '<div><strong>Voice (TTS)</strong></div><div style="margin:8px 0">Text: ' + escapeHtml(obj.text || '') + '</div>' +
							(obj.caption ? '<div style="margin:8px 0">Caption: ' + escapeHtml(obj.caption) + '</div>' : '');
					}
					if (obj.type === 'poll') {
						var opts = (obj.options || []).map(function(o, i) { return (i+1) + '. ' + escapeHtml(o); }).join('<br>');
						return '<div><strong>Poll</strong></div><div style="margin:8px 0">' + escapeHtml(obj.question || '') + '</div><div style="margin:8px 0;font-size:12px">' + opts + '</div>';
					}
					if (obj.type === 'photo' && obj.caption) {
						return '<div><strong>Photo + caption</strong></div><div style="margin:8px 0">' + escapeHtml(obj.caption) + '</div>';
					}
				}
			} catch (e) {}
			return escapeHtml(raw);
		}
		window.showPostPreview = async function() {
			var topic = document.getElementById('postContent')?.value?.trim();
			if (!topic) {
				showToast('Enter a topic first to generate a preview', true);
				return;
			}
			var overlay = document.getElementById('previewModalOverlay');
			var contentEl = document.getElementById('previewContent');
			if (!overlay || !contentEl) return;
			contentEl.textContent = 'Generating...';
			overlay.style.display = '';
			overlay.classList.add('open');
			overlay.setAttribute('aria-hidden', 'false');
			var format = document.getElementById('postFormat')?.value || 'auto';
			try {
				var res = await authFetch('/api/dashboard/posts/preview', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ topic: topic, format: format }),
				});
				var data = await res.json();
				if (data.success && data.content) {
					window._lastPreviewContent = data.content;
					contentEl.innerHTML = formatPreviewContent(data.content);
				} else {
					contentEl.textContent = data.error || 'Preview failed';
				}
			} catch (err) {
				contentEl.textContent = 'Error: ' + (err.message || 'Failed to load preview');
			}
		};
		window.closePreviewPopup = function() {
			var overlay = document.getElementById('previewModalOverlay');
			if (overlay) {
				overlay.classList.remove('open');
				overlay.style.display = 'none';
				overlay.setAttribute('aria-hidden', 'true');
			}
		};
		window.usePreviewAsContent = function() {
			var textarea = document.getElementById('postContent');
			if (textarea && window._lastPreviewContent) {
				textarea.value = window._lastPreviewContent;
				document.getElementById('postGenerateAI') && (document.getElementById('postGenerateAI').checked = false);
				updateContentPlaceholder();
			}
			closePreviewPopup();
		};
		
		window.createPost = async function() {
			// Collect target chats
			const targets = [];
			document.querySelectorAll('input[name="postTarget"]:checked').forEach(function(cb) {
				targets.push({ chatId: cb.value, chatTitle: cb.dataset.title || '' });
			});
			if (targets.length === 0) return showToast('Select at least one channel or group', true);
			
			const content = document.getElementById('postContent')?.value?.trim();
			if (!content) return showToast('Post content is required', true);
			
			const scheduleType = document.querySelector('input[name="postScheduleType"]:checked')?.value || 'now';
			const autoApprove = document.getElementById('postAutoApprove')?.checked ?? true;
			const generateWithAI = document.getElementById('postGenerateAI')?.checked ?? true;
			
			let scheduledAt = undefined;
			let cronExpression = undefined;
			let timezone = undefined;
			
			if (scheduleType === 'scheduled') {
				const rawDt = document.getElementById('postScheduledAt')?.value;
				if (!rawDt) return showToast('Select a date and time', true);
				const localDate = new Date(rawDt);
				if (localDate.getTime() <= Date.now()) {
					return showToast('Scheduled time must be in the future', true);
				}
				scheduledAt = localDate.toISOString();
			}
			
			if (scheduleType === 'recurring') {
				cronExpression = document.getElementById('postCronExpr')?.value?.trim();
				if (!cronExpression) return showToast('Enter a cron expression or select a preset', true);
				if (cronExpression.split(/\\s+/).length !== 5) {
					return showToast('Cron must have 5 fields: minute hour day month weekday', true);
				}
				timezone = document.getElementById('postTimezone')?.value || undefined;
			}
			
			// Build payload
			const payload = {
				targetChats: targets,
				content: content,
				scheduleType: scheduleType,
				scheduledAt: scheduledAt,
				cronExpression: cronExpression,
				timezone: timezone,
				autoApprove: autoApprove,
				generateWithAI: generateWithAI,
				format: document.getElementById('postFormat')?.value || 'auto',
			};
			
			try {
				const btn = document.querySelector('#createPostForm .dash-btn-primary');
				if (btn) { btn.disabled = true; btn.textContent = generateWithAI ? 'Generating...' : 'Publishing...'; }
				
				const res = await authFetch('/api/dashboard/posts', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
				const data = await res.json();
				
				if (btn) { btn.disabled = false; btn.textContent = 'Create Post'; }
				
				if (data.success) {
					const results = data.results || [];
					const published = results.filter(function(r) { return r.status === 'published'; }).length;
					const scheduled = results.filter(function(r) { return r.status === 'scheduled'; }).length;
					const recurring = results.filter(function(r) { return r.status === 'recurring'; }).length;
					const awaiting = results.filter(function(r) { return r.status === 'awaiting-approval'; }).length;
					
					let msg = '';
					if (published > 0) msg += published + ' published. ';
					if (scheduled > 0) msg += scheduled + ' scheduled. ';
					if (recurring > 0) msg += recurring + ' recurring. ';
					if (awaiting > 0) msg += awaiting + ' awaiting approval. ';
					
					showToast(msg.trim() || data.message || 'Post created');
					document.getElementById('createPostForm').style.display = 'none';
					// Clear form
					document.getElementById('postContent').value = '';
					document.querySelectorAll('input[name="postTarget"]').forEach(function(cb) { cb.checked = false; });
					var selectAll = document.getElementById('postSelectAll');
					if (selectAll) selectAll.checked = false;
					loadTaskBoard();
				} else {
					showToast(data.error || 'Failed', true);
				}
			} catch (err) {
				const btn = document.querySelector('#createPostForm .dash-btn-primary');
				if (btn) { btn.disabled = false; btn.textContent = 'Create Post'; }
				showToast('Failed: ' + err.message, true);
			}
		};
		
		let _lastFocusBeforeModal = null;
		
		window.openTaskDetail = async function(taskId) {
			try {
				const res = await authFetch('/api/dashboard/tasks/' + taskId);
				if (!res.ok) throw new Error('Not found');
				selectedTask = await res.json();
				renderTaskModal(selectedTask);
				_lastFocusBeforeModal = document.activeElement;
				const overlay = document.getElementById('taskModalOverlay');
				if (overlay) { overlay.classList.add('open'); overlay.setAttribute('aria-hidden', 'false'); }
				// Move focus into the modal for accessibility
				const closeBtn = document.querySelector('#taskModalContent .modal-close-btn');
				if (closeBtn) closeBtn.focus();
			} catch (err) {
				showToast('Failed to load task', true);
			}
		};
		
		window.closeTaskModal = function() {
			const overlay = document.getElementById('taskModalOverlay');
			if (overlay) { overlay.classList.remove('open'); overlay.setAttribute('aria-hidden', 'true'); }
			selectedTask = null;
			// Restore focus to the element that opened the modal
			if (_lastFocusBeforeModal && _lastFocusBeforeModal.focus) {
				_lastFocusBeforeModal.focus();
				_lastFocusBeforeModal = null;
			}
		};
		
		// Close modal on Escape key
		document.addEventListener('keydown', function(e) {
			if (e.key === 'Escape') {
				const overlay = document.getElementById('taskModalOverlay');
				if (overlay && overlay.classList.contains('open')) {
					e.preventDefault();
					closeTaskModal();
				}
			}
		});
		
		function renderTaskModal(task) {
			const modal = document.getElementById('taskModalContent');
			if (!modal) return;
			
			const kindTag = task.kind === 'persistent' ? 'kanban-tag-persistent'
				: task.kind === 'recurring' ? 'kanban-tag-recurring'
				: 'kanban-tag-oneshot';
			const statusBadge = task.status === 'in-progress' ? 'badge-green'
				: task.status === 'queued' ? 'badge-yellow'
				: task.status === 'done' ? 'badge-blue'
				: 'badge-red';
			
			let html = '';
			html += '<div class="flex-between section-block" style="align-items:start">';
			html += '<div>';
			html += '<h3>' + escapeHtml(task.title) + '</h3>';
			html += '<div class="task-desc">' + escapeHtml(task.description || 'No description') + '</div>';
			html += '<div class="flex-row" style="gap:6px;flex-wrap:wrap">';
			html += '<span class="kanban-tag ' + kindTag + '">' + task.kind + '</span>';
			html += '<span class="badge ' + statusBadge + '">' + task.status + '</span>';
			if (task.role) html += '<span class="badge badge-blue">' + task.role + '</span>';
			if (task.chatTitle) html += '<span class="badge badge-gray">' + escapeHtml(task.chatTitle) + '</span>';
			html += '</div>';
			html += '</div>';
			html += '<button class="modal-close-btn" onclick="closeTaskModal()">&times;</button>';
			html += '</div>';
			
			// Schedule info
			if (task.schedule) {
				html += '<div class="schedule-info-box">';
				if (task.schedule.cron) html += 'Cron: <code>' + escapeHtml(task.schedule.cron) + '</code>';
				if (task.schedule.runAt) html += 'Scheduled: ' + new Date(task.schedule.runAt).toLocaleString();
				html += '</div>';
			}
			
			// Stats
			const statKeys = Object.keys(task.stats || {});
			if (statKeys.length > 0) {
				html += '<div class="label-upper">Statistics</div>';
				html += '<div class="task-stats-grid">';
				statKeys.forEach(function(key) {
					html += '<div class="task-stat-card"><div class="stat-val">' + task.stats[key] + '</div><div class="stat-label">' + escapeHtml(key) + '</div></div>';
				});
				html += '</div>';
			}
			
			// Meta
			html += '<div class="text-muted-xs section-block">';
			html += 'Created: ' + new Date(task.createdAt).toLocaleString();
			if (task.lastRunAt) html += ' | Last run: ' + new Date(task.lastRunAt).toLocaleString();
			html += ' | Runs: ' + (task.runCount || 0);
			html += '</div>';
			
			// Logs
			if (task.logs && task.logs.length > 0) {
				html += '<div class="label-upper">Activity Log</div>';
				html += '<div class="task-logs">';
				task.logs.slice(-30).reverse().forEach(function(log) {
					const time = log.time ? new Date(log.time).toLocaleTimeString() : '';
					html += '<div class="task-log-entry"><span class="task-log-time">' + time + '</span>';
					if (log.category) html += '<span class="badge badge-yellow badge-micro">' + escapeHtml(log.category) + '</span>';
					html += escapeHtml(log.message) + '</div>';
				});
				html += '</div>';
			}
			
			// Approval content preview (for awaiting-approval tasks)
			if (task.status === 'awaiting-approval') {
				if (task.approval && task.approval.content) {
					html += '<div class="label-upper">Post Preview</div>';
					html += '<div class="post-preview-box">';
					html += escapeHtml(task.approval.content);
					html += '</div>';
					if (task.approval.targetChatTitle) {
						html += '<div class="text-muted-xs section-block">Target: ' + escapeHtml(task.approval.targetChatTitle) + '</div>';
					}
				} else {
					html += '<div class="text-muted-xs approval-empty-box">Approval content not available</div>';
				}
				if (task.schedule) {
					if (task.schedule.runAt) {
						html += '<div class="text-muted-xs" style="margin-bottom:12px">Scheduled: ' + new Date(task.schedule.runAt).toLocaleString() + '</div>';
					}
					if (task.schedule.cron) {
						html += '<div class="text-muted-xs" style="margin-bottom:12px">Recurring: <code>' + escapeHtml(task.schedule.cron) + '</code>' + (task.schedule.timezone ? ' (' + task.schedule.timezone + ')' : ' (UTC)') + '</div>';
					}
				}
			}
			
			// Actions
			html += '<div class="task-modal-actions">';
			if (task.status === 'awaiting-approval') {
				html += '<button class="dash-btn dash-btn-primary" onclick="approveTask(\\'' + task.id + '\\')">Approve & Publish</button>';
				html += '<button class="dash-btn btn-danger-outline" onclick="rejectTask(\\'' + task.id + '\\')">Reject</button>';
			}
			if (task.status === 'queued') {
				html += '<button class="dash-btn dash-btn-primary" onclick="moveTaskTo(\\'' + task.id + '\\', \\'in-progress\\')">Start</button>';
			}
			if (task.status === 'in-progress') {
				html += '<button class="dash-btn dash-btn-success" onclick="moveTaskTo(\\'' + task.id + '\\', \\'done\\')">Complete</button>';
			}
			if (task.status !== 'queued' && task.status !== 'in-progress' && task.status !== 'awaiting-approval') {
				html += '<button class="dash-btn" onclick="moveTaskTo(\\'' + task.id + '\\', \\'queued\\')">Requeue</button>';
			}
			html += '<button class="dash-btn btn-danger-outline" onclick="deleteKanbanTask(\\'' + task.id + '\\')">Delete</button>';
			html += '</div>';
			
			modal.innerHTML = html;
		}
		
		window.moveTaskTo = async function(taskId, newStatus) {
			try {
				const res = await authFetch('/api/dashboard/tasks/' + taskId + '/move', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ status: newStatus }),
				});
				if (!res.ok) throw new Error('Failed');
				showToast('Task moved to ' + newStatus);
				closeTaskModal();
				loadTaskBoard();
			} catch (err) {
				showToast('Failed: ' + err.message, true);
			}
		};
		
		window.approveTask = async function(taskId) {
			if (!confirm('Approve and publish this post?')) return;
			try {
				const res = await authFetch('/api/dashboard/tasks/' + taskId + '/approve', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({}),
				});
				const data = await res.json();
				if (data.success) {
					showToast(data.message || 'Approved!');
					closeTaskModal();
					loadTaskBoard();
				} else {
					showToast(data.error || 'Failed', true);
				}
			} catch (err) {
				showToast('Failed: ' + err.message, true);
			}
		};
		
		window.rejectTask = async function(taskId) {
			if (!confirm('Reject this post?')) return;
			try {
				const res = await authFetch('/api/dashboard/tasks/' + taskId + '/reject', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({}),
				});
				const data = await res.json();
				if (data.success) {
					showToast(data.message || 'Post rejected');
					closeTaskModal();
					loadTaskBoard();
				} else {
					showToast(data.error || 'Failed to reject', true);
				}
			} catch (err) {
				showToast('Failed: ' + err.message, true);
			}
		};
		
		window.deleteKanbanTask = async function(taskId) {
			if (!confirm('Delete this task?')) return;
			try {
				const res = await authFetch('/api/dashboard/tasks/' + taskId, { method: 'DELETE' });
				if (!res.ok) throw new Error('Failed');
				showToast('Task deleted');
				closeTaskModal();
				loadTaskBoard();
			} catch (err) {
				showToast('Failed: ' + err.message, true);
			}
		};
		
		// ── Toast notification ──
		function showToast(message, isError) {
			let toast = document.getElementById('dashToast');
			if (!toast) {
				toast = document.createElement('div');
				toast.id = 'dashToast';
				toast.className = 'dash-toast';
				document.body.appendChild(toast);
			}
			toast.textContent = message;
			toast.classList.remove('toast-error', 'toast-success');
			toast.classList.add(isError ? 'toast-error' : 'toast-success');
			toast.classList.add('show');
			clearTimeout(toast._timer);
			toast._timer = setTimeout(() => toast.classList.remove('show'), 3500);
		}
		
		// ── Button loading helper ──
		function withLoading(btn, loadingText) {
			if (!btn) return { done: function(){} };
			const origText = btn.textContent;
			btn.disabled = true;
			btn.textContent = loadingText || 'Saving...';
			return {
				done: function(success) {
					btn.disabled = false;
					if (success) {
						btn.textContent = 'Saved!';
						setTimeout(function() { btn.textContent = origText; }, 1500);
					} else {
						btn.textContent = origText;
					}
				}
			};
		}
		
		// ── Load settings for a specific chat ──
		async function loadChatSettings(chatId) {
			if (!chatId) return;
			selectedChatId = chatId;
			
			const container = document.getElementById('settingsContent');
			if (!container) return;
			container.innerHTML = '<div class="dash-loading">Loading settings...</div>';
			
			try {
				const [settingsRes, setupRes] = await Promise.all([
					authFetch('/api/dashboard/settings/' + chatId),
					authFetch('/api/dashboard/setup', { signal: AbortSignal.timeout(5000) }),
				]);
				if (!settingsRes.ok) throw new Error('Status ' + settingsRes.status);
				settingsData = await settingsRes.json();
				const setupData = setupRes.ok ? await setupRes.json() : {};
				const chatRoles = setupData.roles || setupRoles || [];
				renderSettings(settingsData, chatRoles);
			} catch (error) {
				container.innerHTML = '<div class="dash-empty">Failed to load settings: ' + error.message + '</div>';
			}
		}
		window.loadChatSettings = loadChatSettings;
		
		// ── Render settings forms ──
		function renderSettings(data, roles) {
			const container = document.getElementById('settingsContent');
			if (!container) return;
			
			const mod = data.moderation || {};
			const pro = data.proactive || {};
			const ch = data.channel || {};
			const session = data.session || {};
			const availableAgents = data.availableAgents || [];
			const chatType = chatTypeMap[String(selectedChatId)] || 'group';
			const isChannel = chatType === 'channel';
			
			// Role-based visibility: show all if no roles set (backward compat)
			const hasRoles = roles && roles.length > 0;
			const showModeration = !hasRoles || roles.includes('moderator');
			const showChannelPosting = isChannel && (!hasRoles || roles.includes('content'));
			const showProactive = !hasRoles || roles.includes('support');
			
			let html = '';
			
			// ── Agent Selection ──
			html += '<div class="settings-group"><h3>Active Agent</h3>';
			html += '<div class="setting-row">';
			html += '<div class="setting-label">AI Agent for this chat<small>Which agent handles messages from this chat</small></div>';
			html += '<select class="setting-select" id="agentSelect" onchange="saveAgentSetting(this.value)">';
			availableAgents.forEach(a => {
				const selected = session.selectedAgentId === a.id ? ' selected' : '';
				html += '<option value="' + a.id + '"' + selected + '>' + escapeHtml(a.name) + '</option>';
			});
			html += '</select>';
			html += '</div></div>';
			
			if (isChannel && showChannelPosting) {
				// ════════════ CHANNEL-SPECIFIC SETTINGS ════════════
				
				// ── Channel Posting Settings ──
				html += '<div class="settings-group"><h3>Channel Posting</h3>';
				
				html += renderToggle('chAutoPost', 'Auto-posting', 'Allow the bot to post content automatically', ch.autoPost === true);
				
				html += '<div id="chPostDetails" class="' + (ch.autoPost ? '' : 'section-disabled') + '">';
				
				html += '<div class="setting-row" style="margin-top:12px">';
				html += '<div class="setting-label">Posting Frequency<small>How often to auto-post</small></div>';
				html += '<select class="setting-select" id="chFrequency">';
				['manual', '1h', '3h', '6h', '12h', '24h'].forEach(f => {
					const labels = { manual: 'Manual only', '1h': 'Every hour', '3h': 'Every 3 hours', '6h': 'Every 6 hours', '12h': 'Every 12 hours', '24h': 'Once a day' };
					html += '<option value="' + f + '"' + ((ch.frequency || 'manual') === f ? ' selected' : '') + '>' + labels[f] + '</option>';
				});
				html += '</select></div>';
				
				html += '<div class="setting-row">';
				html += '<div class="setting-label">Content Tone<small>Style of generated posts</small></div>';
				html += '<select class="setting-select" id="chTone">';
				['neutral', 'professional', 'casual', 'engaging', 'informative'].forEach(t => {
					html += '<option value="' + t + '"' + ((ch.tone || 'neutral') === t ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
				});
				html += '</select></div>';
				
				html += '<div class="setting-row">';
				html += '<div class="setting-label">Max Posts / Day<small>Daily limit for auto-posts</small></div>';
				html += '<input type="number" class="setting-input" id="chMaxPerDay" min="1" max="50" value="' + (ch.maxPostsPerDay || 5) + '"/>';
				html += '</div>';
				
				html += '</div>';
				
				html += '<div style="margin-top:12px">';
				html += '<div class="label-upper" style="margin-bottom:8px">Content Guidelines</div>';
				html += '<textarea class="setting-textarea" id="chGuidelines" rows="4" placeholder="Describe the topics, style, and rules for auto-generated content...">' + escapeHtml(ch.guidelines || '') + '</textarea>';
				html += '</div>';
				
				html += '<div style="margin-top:16px"><button class="dash-btn dash-btn-primary" onclick="saveChannelSettings()">Save Channel Settings</button></div>';
				html += '</div>';
				
				// ── Channel Signature ──
				html += '<div class="settings-group"><h3>Post Signature</h3>';
				html += '<div class="setting-row">';
				html += '<div class="setting-label">Signature Text<small>Appended to every post (optional)</small></div>';
				html += '<input type="text" class="setting-input" id="chSignature" value="' + escapeHtml(ch.signature || '') + '" placeholder="e.g. — YourBrand"/>';
				html += '</div>';
				html += renderToggle('chHashtags', 'Auto-hashtags', 'Automatically add relevant hashtags', ch.autoHashtags === true);
				html += '</div>';
				
			} else {
				// ════════════ GROUP/SUPERGROUP SETTINGS ════════════
				
				if (showModeration) {
				// ── Moderation Settings ──
				html += '<div class="settings-group"><h3>Moderation</h3>';
				
				html += renderToggle('modEnabled', 'Enable Moderation', 'Auto-moderate messages in this chat', mod.enabled);
				
				html += '<div id="modDetails" class="' + (mod.enabled ? '' : 'section-disabled') + '">';
				html += '<div class="label-upper label-upper-spaced">Detection</div>';
				html += renderToggle('modSpam', 'Detect Spam', 'Block spam messages', mod.detectSpam !== false);
				html += renderToggle('modScam', 'Detect Scam', 'Block scam/phishing attempts', mod.detectScam !== false);
				html += renderToggle('modHate', 'Detect Hate Speech', 'Filter hateful content', mod.detectHate !== false);
				html += renderToggle('modFlood', 'Detect Flood', 'Rate-limit message flooding', mod.detectFlood !== false);
				html += renderToggle('modLinks', 'Detect Links', 'Filter unauthorized links', mod.detectLinks === true);
				
				html += '<div class="label-upper label-upper-spaced-lg">Actions</div>';
				html += renderActionSelect('modSpamAction', 'Spam Action', mod.spamAction || 'delete');
				html += renderActionSelect('modScamAction', 'Scam Action', mod.scamAction || 'ban');
				html += renderActionSelect('modHateAction', 'Hate Action', mod.hateAction || 'warn');
				html += renderActionSelect('modFloodAction', 'Flood Action', mod.floodAction || 'mute');
				html += renderActionSelect('modLinksAction', 'Links Action', mod.linksAction || 'delete');
				html += '</div>';
				
				html += '<div style="margin-top:16px"><button class="dash-btn dash-btn-primary" onclick="saveModerationSettings()">Save Moderation</button></div>';
				html += '</div>';
				}
				
				if (!isChannel && showProactive) {
				// ── Proactive Mode Settings ──
				html += '<div class="settings-group"><h3>Proactive Mode</h3>';
				
				html += '<div class="setting-row">';
				html += '<div class="setting-label">Mode<small>How the bot participates in conversations</small></div>';
				html += '<select class="setting-select" id="proMode" onchange="toggleProDetails(this.value)">';
				['off', 'support', 'community', 'custom'].forEach(m => {
					html += '<option value="' + m + '"' + (pro.mode === m ? ' selected' : '') + '>' + m.charAt(0).toUpperCase() + m.slice(1) + '</option>';
				});
				html += '</select></div>';
				
				html += '<div id="proDetails" class="' + (pro.mode && pro.mode !== 'off' ? '' : 'section-disabled') + '">';
				
				html += '<div class="label-upper label-upper-spaced">Triggers</div>';
				html += renderToggle('proMentions', 'Respond to Mentions', 'Reply when bot is mentioned', pro.respondToMentions !== false);
				html += renderToggle('proReplies', 'Respond to Replies', 'Reply to messages that reply to bot', pro.respondToReplies !== false);
				html += renderToggle('proQuestions', 'Respond to Questions', 'Detect and answer questions', pro.respondToQuestions === true);
				
				html += '<div style="margin-top:12px">';
				html += '<div class="setting-row">';
				html += '<div class="setting-label">Response Probability<small>Chance of responding (' + (pro.responseProbability || 30) + '%)</small></div>';
				html += '<input type="range" class="setting-range" id="proProbability" min="0" max="100" value="' + (pro.responseProbability || 30) + '" oninput="this.closest(\\'.setting-row\\').querySelector(\\'small\\').textContent=\\'Chance of responding (\\'+this.value+\\'%)\\'"/>';
				html += '</div>';
				
				html += '<div class="setting-row">';
				html += '<div class="setting-label">Max Responses / Hour<small>Rate limit</small></div>';
				html += '<input type="number" class="setting-input" id="proMaxHour" min="1" max="100" value="' + (pro.maxResponsesPerHour || 20) + '"/>';
				html += '</div>';
				html += '</div>';
				
				html += '<div style="margin-top:12px">';
				html += '<div class="label-upper" style="margin-bottom:8px">System Prompt</div>';
				html += '<textarea class="setting-textarea" id="proPrompt" rows="4" placeholder="Custom system prompt for the bot...">' + escapeHtml(pro.systemPrompt || '') + '</textarea>';
				html += '</div>';
				
				html += '</div>';
				
				html += '<div style="margin-top:16px"><button class="dash-btn dash-btn-primary" onclick="saveProactiveSettings()">Save Proactive</button></div>';
				html += '</div>';
				}
				
				if (!isChannel && showModeration) {
				// ── Moderation Logs ──
				html += '<div class="settings-group">';
				html += '<h3 class="flex-between">Moderation Logs';
				html += '<div class="flex-row" style="gap:6px"><button class="dash-btn btn-sm" onclick="loadModLogs()">Refresh</button>';
				html += '<button class="dash-btn btn-sm btn-danger-outline" onclick="clearModLogs()">Clear</button></div>';
				html += '</h3>';
				html += '<div id="modLogsContainer"><div class="empty-msg">Click Refresh to load logs</div></div>';
				html += '</div>';
				}
			}
			
			container.innerHTML = html;
			
			// Wire up moderation enable toggle
			const modToggle = document.getElementById('modEnabled');
			if (modToggle) {
				modToggle.addEventListener('change', function() {
					const details = document.getElementById('modDetails');
					if (details) details.classList.toggle('section-disabled', !this.checked);
				});
			}
			
			// Wire up channel auto-post toggle
			const chToggle = document.getElementById('chAutoPost');
			if (chToggle) {
				chToggle.addEventListener('change', function() {
					const details = document.getElementById('chPostDetails');
					if (details) details.classList.toggle('section-disabled', !this.checked);
				});
			}
		}
		
		// ── Helpers for rendering settings controls ──
		function renderToggle(id, label, description, checked) {
			return '<div class="setting-row">' +
				'<div class="setting-label">' + escapeHtml(label) + '<small>' + escapeHtml(description) + '</small></div>' +
				'<label class="setting-toggle"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '/><span class="slider"></span></label>' +
				'</div>';
		}
		
		function renderActionSelect(id, label, value) {
			const actions = ['none', 'delete', 'warn', 'mute', 'ban'];
			let options = '';
			actions.forEach(a => {
				options += '<option value="' + a + '"' + (value === a ? ' selected' : '') + '>' + a.charAt(0).toUpperCase() + a.slice(1) + '</option>';
			});
			return '<div class="setting-row">' +
				'<div class="setting-label">' + escapeHtml(label) + '</div>' +
				'<select class="setting-select" id="' + id + '">' + options + '</select>' +
				'</div>';
		}
		
		window.toggleProDetails = function(mode) {
			const details = document.getElementById('proDetails');
			if (details) details.classList.toggle('section-disabled', mode === 'off');
		};
		
		// ── Save moderation settings ──
		window.saveModerationSettings = async function() {
			if (!selectedChatId) return;
			const loader = withLoading(document.querySelector('[onclick*="saveModerationSettings"]'));
			try {
				const payload = {
					chatId: selectedChatId,
					enabled: document.getElementById('modEnabled')?.checked || false,
					detectSpam: document.getElementById('modSpam')?.checked || false,
					detectScam: document.getElementById('modScam')?.checked || false,
					detectHate: document.getElementById('modHate')?.checked || false,
					detectFlood: document.getElementById('modFlood')?.checked || false,
					detectLinks: document.getElementById('modLinks')?.checked || false,
					spamAction: document.getElementById('modSpamAction')?.value || 'delete',
					scamAction: document.getElementById('modScamAction')?.value || 'ban',
					hateAction: document.getElementById('modHateAction')?.value || 'warn',
					floodAction: document.getElementById('modFloodAction')?.value || 'mute',
					linksAction: document.getElementById('modLinksAction')?.value || 'delete',
				};
				const res = await authFetch('/api/dashboard/settings/moderation', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
				if (!res.ok) throw new Error('Status ' + res.status);
				showToast('Moderation settings saved');
				loader.done(true);
			} catch (err) {
				showToast('Failed to save: ' + err.message, true);
				loader.done(false);
			}
		};
		
		// ── Save proactive settings ──
		window.saveProactiveSettings = async function() {
			if (!selectedChatId) return;
			const loader = withLoading(document.querySelector('[onclick*="saveProactiveSettings"]'));
			try {
				const payload = {
					chatId: selectedChatId,
					mode: document.getElementById('proMode')?.value || 'off',
					respondToMentions: document.getElementById('proMentions')?.checked || false,
					respondToReplies: document.getElementById('proReplies')?.checked || false,
					respondToQuestions: document.getElementById('proQuestions')?.checked || false,
					responseProbability: parseInt(document.getElementById('proProbability')?.value || '30'),
					maxResponsesPerHour: parseInt(document.getElementById('proMaxHour')?.value || '20'),
					systemPrompt: document.getElementById('proPrompt')?.value || '',
				};
				const res = await authFetch('/api/dashboard/settings/proactive', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
				if (!res.ok) throw new Error('Status ' + res.status);
				showToast('Proactive settings saved');
				loader.done(true);
			} catch (err) {
				showToast('Failed to save: ' + err.message, true);
				loader.done(false);
			}
		};
		
		// ── Save channel settings ──
		window.saveChannelSettings = async function() {
			if (!selectedChatId) return;
			const loader = withLoading(document.querySelector('[onclick*="saveChannelSettings"]'));
			try {
				const payload = {
					chatId: selectedChatId,
					autoPost: document.getElementById('chAutoPost')?.checked || false,
					frequency: document.getElementById('chFrequency')?.value || 'manual',
					tone: document.getElementById('chTone')?.value || 'neutral',
					maxPostsPerDay: parseInt(document.getElementById('chMaxPerDay')?.value || '5'),
					guidelines: document.getElementById('chGuidelines')?.value || '',
					signature: document.getElementById('chSignature')?.value || '',
					autoHashtags: document.getElementById('chHashtags')?.checked || false,
				};
				const res = await authFetch('/api/dashboard/settings/channel', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
				if (!res.ok) throw new Error('Status ' + res.status);
				showToast('Channel settings saved');
				loader.done(true);
			} catch (err) {
				showToast('Failed to save: ' + err.message, true);
				loader.done(false);
			}
		};
		
		// ── Load moderation logs ──
		window.loadModLogs = async function() {
			if (!selectedChatId) return;
			const container = document.getElementById('modLogsContainer');
			if (!container) return;
			container.innerHTML = '<div class="empty-msg">Loading...</div>';
			
			try {
				const res = await authFetch('/api/dashboard/settings/' + selectedChatId + '/moderation-logs');
				if (!res.ok) throw new Error('Status ' + res.status);
				const data = await res.json();
				const logs = data.logs || [];
				
				if (logs.length === 0) {
					container.innerHTML = '<div class="empty-msg" style="padding:16px">No moderation actions recorded yet.</div>';
					return;
				}
				
				let html = '<div class="text-tertiary-sm section-block">' + data.total + ' total actions</div>';
				html += '<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Time</th><th>Category</th><th>Action</th><th>Confidence</th><th>User</th><th>Message</th></tr></thead><tbody>';
				logs.slice(0, 50).forEach(function(log) {
					const time = log.timestamp ? new Date(log.timestamp).toLocaleString() : '—';
					// result object contains category/action/confidence
					const r = log.result || {};
					const cat = r.category || log.category || '—';
					const act = log.actionTaken || r.action || log.action || '—';
					const conf = r.confidence ? Math.round(r.confidence * 100) + '%' : '—';
					const catBadge = cat === 'spam' ? 'badge-red'
						: cat === 'scam' ? 'badge-red'
						: cat === 'hate' ? 'badge-red'
						: cat === 'flood' ? 'badge-yellow'
						: 'badge-gray';
					const actBadge = act === 'ban' ? 'badge-red'
						: act === 'delete' ? 'badge-yellow'
						: act === 'mute' ? 'badge-yellow'
						: act === 'warn' ? 'badge-blue'
						: 'badge-gray';
					const msg = log.messageText || log.message || '';
					const msgPreview = msg.substring(0, 40) + (msg.length > 40 ? '...' : '');
					html += '<tr>';
					html += '<td class="text-muted-xs" style="white-space:nowrap">' + escapeHtml(time) + '</td>';
					html += '<td><span class="badge ' + catBadge + '">' + escapeHtml(cat) + '</span></td>';
					html += '<td><span class="badge ' + actBadge + '">' + escapeHtml(act) + '</span></td>';
					html += '<td class="text-tertiary-sm" style="text-align:center">' + escapeHtml(conf) + '</td>';
					html += '<td class="text-tertiary-sm">' + escapeHtml(log.username ? '@' + log.username : log.userId ? 'id:' + log.userId : '—') + '</td>';
					html += '<td class="text-tertiary-sm td-truncate" title="' + escapeHtml(msg) + '">' + escapeHtml(msgPreview) + '</td>';
					html += '</tr>';
				});
				html += '</tbody></table></div>';
				container.innerHTML = html;
			} catch (err) {
				container.innerHTML = '<div class="error-msg" style="padding:12px">Error: ' + err.message + '</div>';
			}
		};
		
		window.clearModLogs = async function() {
			if (!selectedChatId || !confirm('Clear all moderation logs for this chat?')) return;
			try {
				const res = await authFetch('/api/dashboard/settings/' + selectedChatId + '/moderation-logs', { method: 'DELETE' });
				if (!res.ok) throw new Error('Status ' + res.status);
				showToast('Logs cleared');
				loadModLogs();
			} catch (err) {
				showToast('Failed: ' + err.message, true);
			}
		};
		
		// ── Save agent selection ──
		window.saveAgentSetting = async function(agentId) {
			if (!selectedChatId) return;
			try {
				const res = await authFetch('/api/dashboard/settings/agent', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ chatId: selectedChatId, agentId }),
				});
				if (!res.ok) throw new Error('Status ' + res.status);
				const data = await res.json();
				showToast('Agent switched to ' + (data.agent?.name || agentId));
			} catch (err) {
				showToast('Failed: ' + err.message, true);
			}
		};
		
		// cancelPost removed — use kanban board to manage scheduled tasks
		
		// ── Webhook management ──
		async function loadWebhookInfo() {
			const container = document.getElementById('webhookStatus');
			if (!container) return;
			
			try {
				const res = await authFetch('/api/dashboard/webhook');
				const data = await res.json();
				
				if (!data.configured) {
					container.innerHTML = '<span class="badge badge-gray">Bot token not configured</span>';
					return;
				}
				
				const wh = data.webhook || {};
				let html = '<div style="font-size:13px">';
				html += '<div class="setting-row"><div class="setting-label">URL</div><div class="mono-val break-word">' + escapeHtml(wh.url || 'Not set') + '</div></div>';
				html += '<div class="setting-row"><div class="setting-label">Pending Updates</div><div>' + (wh.pending_update_count || 0) + '</div></div>';
				if (wh.last_error_message) {
					html += '<div class="setting-row"><div class="setting-label">Last Error</div><div style="color:var(--danger)">' + escapeHtml(wh.last_error_message) + '</div></div>';
				}
				html += '<div class="setting-row"><div class="setting-label">Has Custom Cert</div><div>' + (wh.has_custom_certificate ? 'Yes' : 'No') + '</div></div>';
				html += '</div>';
				
				container.innerHTML = html;
			} catch (err) {
				container.innerHTML = '<span class="text-danger">Error loading webhook info</span>';
			}
		}
		
		window.setWebhook = async function() {
			const urlInput = document.getElementById('webhookUrlInput');
			if (!urlInput?.value) return showToast('Enter a webhook URL', true);
			
			try {
				const res = await authFetch('/api/dashboard/webhook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ url: urlInput.value }),
				});
				const data = await res.json();
				if (data.success) {
					showToast('Webhook set to ' + data.webhookUrl);
					loadWebhookInfo();
				} else {
					showToast(data.error || 'Failed', true);
				}
			} catch (err) {
				showToast('Failed: ' + err.message, true);
			}
		};
		
		window.setWebhookAuto = async function() {
			try {
				const res = await authFetch('/api/dashboard/webhook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ auto: true }),
				});
				const data = await res.json();
				if (data.webhookUrl) {
					document.getElementById('webhookUrlInput').value = data.webhookUrl;
				}
				if (data.success) {
					showToast('Webhook set to ' + data.webhookUrl);
					loadWebhookInfo();
				} else {
					showToast(data.error || 'Failed (use HTTPS URL for production)', true);
				}
			} catch (err) {
				showToast('Failed: ' + err.message, true);
			}
		};
		
		function escapeHtml(text) {
			const div = document.createElement('div');
			div.textContent = text;
			return div.innerHTML;
		}
		
		// Copy code block content to clipboard
		window.copyCodeBlock = function(btn) {
			const pre = btn.closest('pre');
			if (!pre) return;
			const code = pre.querySelector('code');
			if (!code) return;
			navigator.clipboard.writeText(code.textContent).then(() => {
				btn.textContent = 'Copied!';
				btn.classList.add('copied');
				setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
			}).catch(() => {
				btn.textContent = 'Failed';
				setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
			});
		};
		
		// ── Simple Markdown → HTML (safe, escapes first) ──
		function renderMarkdown(text) {
			if (!text) return '';
			// Escape HTML first for safety
			let html = escapeHtml(text);
			// Code blocks: \`\`\`lang...\\n\`\`\` → <pre><code> with copy button + lang label
			html = html.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, function(_, lang, code) {
				const langLabel = lang ? '<span class="md-lang">' + lang + '</span>' : '';
				return '<pre class="md-codeblock">' + langLabel + '<button class="md-copy-btn" onclick="copyCodeBlock(this)">Copy</button><code>' + code.trim().replace(/\`/g, '&#96;').replace(/\\*/g, '&#42;') + '</code></pre>';
			});
			// Inline code: \`...\` → <code>
			html = html.replace(/\`([^\`\\n]+)\`/g, '<code>$1</code>');
			// Bold: **...** → <strong>
			html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
			// Italic: *...* (not preceded/followed by *)
			html = html.replace(/(?<!\\*)\\*([^*\\n]+)\\*(?!\\*)/g, '<em>$1</em>');
			// Strikethrough: ~~...~~ → <del>
			html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
			// Horizontal rule: --- or *** or ___ on its own line
			html = html.replace(/^(?:---|\\*\\*\\*|___)$/gm, '<hr class="md-hr">');
			// Blockquotes: > text (consecutive lines)
			html = html.replace(/(?:^|\\n)((?:&gt; .+\\n?)+)/g, function(match, block) {
				const content = block.trim().split('\\n').map(function(line) {
					return line.replace(/^&gt; /, '');
				}).join('\\n');
				return '\\n<blockquote class="md-blockquote">' + content + '</blockquote>\\n';
			});
			// Headers: # ... → <h4>, ## ... → <h5> (compact within chat)
			html = html.replace(/^### (.+)$/gm, '<strong class="md-h3">$1</strong>');
			html = html.replace(/^## (.+)$/gm, '<strong class="md-h2">$1</strong>');
			html = html.replace(/^# (.+)$/gm, '<strong class="md-h1">$1</strong>');
			// Images: ![alt](url) → <img> (must come before links)
			html = html.replace(/!\\[([^\\]]*)\\]\\((\\/[^)]+|https?:\\/\\/[^)]+)\\)/g, function(_, alt, src) {
				return '<div class="md-image-wrap"><img src="' + src + '" alt="' + alt + '" class="md-image" loading="lazy" onclick="window.open(this.src,\\'_blank\\')"><div class="md-image-caption">' + (alt || '') + '</div></div>';
			});
			// Audio links: [text](/media/audio/ID) → <audio> player
			html = html.replace(/\\[([^\\]]+)\\]\\((\\/media\\/audio\\/[^)]+)\\)/g, function(_, text, src) {
				return '<div class="md-audio-wrap"><div class="md-audio-label">' + text + '</div><audio controls preload="none" src="' + src + '" class="md-audio"></audio></div>';
			});
			// Links: [text](url) → <a>
			html = html.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
			// Bare URLs: https://... → <a>
			html = html.replace(/(?<!["=])(https?:\\/\\/[^\\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
			// Unordered lists: lines starting with - or *
			html = html.replace(/(?:^|\\n)((?:[-*] .+\\n?)+)/g, function(match, block) {
				const items = block.trim().split('\\n').map(function(line) {
					return '<li>' + line.replace(/^[-*] /, '') + '</li>';
				}).join('');
				return '\\n<ul class="md-list">' + items + '</ul>\\n';
			});
			// Ordered lists: lines starting with 1. 2. etc
			html = html.replace(/(?:^|\\n)((?:\\d+\\. .+\\n?)+)/g, function(match, block) {
				const items = block.trim().split('\\n').map(function(line) {
					return '<li>' + line.replace(/^\\d+\\. /, '') + '</li>';
				}).join('');
				return '\\n<ol class="md-list">' + items + '</ol>\\n';
			});
			// Line breaks (preserve newlines outside code blocks)
			html = html.replace(/\\n/g, '<br>');
			// Fix: remove <br> inside <pre> tags (they already handle whitespace)
			html = html.replace(/<pre class="md-codeblock">([\\s\\S]*?)<\\/pre>/g, function(match) {
				return match.replace(/<br>/g, '\\n');
			});
			// Fix: remove <br> inside list tags
			html = html.replace(/<(ul|ol) class="md-list">([\\s\\S]*?)<\\/\\1>/g, function(match) {
				return match.replace(/<br>/g, '');
			});
			// Fix: convert <br> to \\n inside blockquotes (whitespace preserved by CSS)
			html = html.replace(/<blockquote class="md-blockquote">([\\s\\S]*?)<\\/blockquote>/g, function(match) {
				return match.replace(/<br>/g, '\\n');
			});
			return html;
		}
		
		// ═══════════════════════════════════════════════
		// Chat (existing functionality)
		// ═══════════════════════════════════════════════
		
		// Initialize agents dropdown
		function initAgents() {
			agentSelect.innerHTML = '';
			AGENTS.forEach(agent => {
				const option = document.createElement('option');
				option.value = agent.id;
				option.textContent = agent.name;
				if (agent.description) {
					option.title = agent.description;
				}
				agentSelect.appendChild(option);
			});
			
			if (AGENTS.length > 0) {
				currentAgent = AGENTS[0];
				agentSelect.value = currentAgent.id;
				updateSystemPromptVisibility();
				loadChatHistory(currentAgent.id);
			}
		}
		
		// Save chat history to localStorage
		function saveChatHistory() {
			if (!currentAgent) return;
			try {
				const messages = Array.from(messagesDiv.children)
					.filter(msg => msg.classList.contains('user') || msg.classList.contains('assistant'))
					.map(msg => {
						const clone = msg.cloneNode(true);
						var timeEl = clone.querySelector('.message-time');
						if (timeEl) timeEl.remove();
						var actEl = clone.querySelector('.msg-actions');
						if (actEl) actEl.remove();
						return {
							role: msg.classList.contains('user') ? 'user' : 'assistant',
							content: clone.textContent,
							timestamp: msg.dataset.timestamp || null,
							audioUrl: msg.dataset.audioUrl || null
						};
					});
				localStorage.setItem('chat_history_' + currentAgent.id, JSON.stringify(messages));
				localStorage.setItem('chat_session_' + currentAgent.id, sessionId);
			} catch (e) {
				console.error('Failed to save chat history:', e);
			}
		}
		
		// Load chat history from localStorage
		function loadChatHistory(agentId) {
			messagesDiv.innerHTML = '';
			try {
				const saved = localStorage.getItem('chat_history_' + agentId);
				const savedSession = localStorage.getItem('chat_session_' + agentId);
				if (saved) {
					const messages = JSON.parse(saved);
					messages.forEach(msg => addMessage(msg.role, msg.content, msg.timestamp, msg.audioUrl || ''));
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
			showChatEmptyState();
		}
		
		function showChatEmptyState() {
			if (messagesDiv.children.length === 0) {
				messagesDiv.innerHTML = '<div class="chat-empty-state"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><div>Start a conversation</div><div class="text-muted-sm">Type a message below to chat with the agent</div></div>';
			}
		}
		
		function clearChatEmptyState() {
			const empty = messagesDiv.querySelector('.chat-empty-state');
			if (empty) empty.remove();
		}
		
		function updateSystemPromptVisibility() {
			var show = !currentAgent || currentAgent.systemPrompt !== false;
			spBtn.style.display = show ? '' : 'none';
		}

		var autoVoiceCheck = document.getElementById('autoVoiceCheck');

		function getAutoVoiceKey() {
			return currentAgent ? 'auto_voice_' + currentAgent.id : null;
		}

		function isAutoVoiceEnabled() {
			var key = getAutoVoiceKey();
			return key ? localStorage.getItem(key) === '1' : false;
		}

		function loadModalOptions() {
			autoVoiceCheck.checked = isAutoVoiceEnabled();
		}

		// Agent selection change
		agentSelect.addEventListener('change', (e) => {
			const selected = AGENTS.find(a => a.id === e.target.value);
			if (selected) {
				saveChatHistory();
				currentAgent = selected;
				updateSystemPromptVisibility();
				loadChatHistory(selected.id);
				checkHealth();
				loadMcpServers();
			}
		});
		
		// New chat button
		newChatBtn.addEventListener('click', () => {
			if (!currentAgent) return;
			if (!confirm('Clear chat history and start a new conversation?')) return;
			
			localStorage.removeItem('chat_history_' + currentAgent.id);
			localStorage.removeItem('chat_session_' + currentAgent.id);
			messagesDiv.innerHTML = '';
			sessionId = crypto.randomUUID();
			showChatEmptyState();
		});
		
		// ═══════════════════════════════════════════════
		// System Prompt Editor
		// ═══════════════════════════════════════════════
		const spModal = document.getElementById('systemPromptModal');
		const spInput = document.getElementById('systemPromptInput');
		const spSaveBtn = document.getElementById('spSaveBtn');
		const spSaveLibBtn = document.getElementById('spSaveLibBtn');
		const spCloseBtn = document.getElementById('spModalClose');
		const spBtn = document.getElementById('systemPromptBtn');
		const spTemplatesEl = document.getElementById('spTemplates');

		const SP_DEFAULT = 'You are a friendly, helpful AI assistant. Have natural conversations with users. Answer questions, help with tasks, and be conversational.';

		const SP_TEMPLATES = [
			{ id:'default', label:'Default', prompt: SP_DEFAULT },
			{ id:'angry', label:'Grumpy Genius',
			  prompt:'You are a genius who is perpetually annoyed. You give correct answers wrapped in theatrical exasperation and backhanded compliments. Every question is painfully obvious to you. You sigh dramatically, say "Oh for the love of..." but never refuse to help. You secretly love showing off.' },
			{ id:'psych', label:'Therapist',
			  prompt:'You are a warm therapist. Never diagnose. Ask open-ended questions, reflect feelings, validate emotions. "It sounds like...", "How does that feel?". Calm, patient, caring. Always note you are AI and suggest professional help for serious issues.' },
			{ id:'monk', label:'Zen Monk',
			  prompt:'You are an old Buddhist monk. Speak calmly with nature metaphors. Answer questions with questions. Use real concepts: impermanence, middle way, beginner mind. Tell short parables. Say "Hmm" before responding. Redirect urgency toward presence.' },
			{ id:'nullshot', label:'Nullshot Support',
			  prompt:'Senior support engineer at Nullshot \\u2014 AI infrastructure on Cloudflare Workers. Expert in MCP, Durable Objects, Hono, Workers AI, Vercel AI SDK. Give code examples, explain architecture, suggest best practices. Friendly-professional like a smart Slack colleague.' },
			{ id:'sneakers', label:'Sneaker Shop',
			  prompt:'Concierge at SOLE DISTRICT sneaker boutique. Know every Jordan colorway, Dunk vs SB Dunk, resale trends. Hype-culture voice, not cringe. Help find pairs by style/budget. Know sizing quirks across brands. Handle orders and restock alerts.' },
			{ id:'apple', label:'Apple Support',
			  prompt:'Apple Support Genius. Calm, polished, solution-oriented. Understand the issue first, then walk through steps one by one with exact menu paths. Know every Apple product. Never blame user. Suggest Apple Store visit when needed.' },
			{ id:'pirate', label:'Pirate Captain',
			  prompt:'Captain Blackbyte, pirate of the digital seas. Full pirate dialect: "ye", "arr", "me hearties". Code is "treasure maps", bugs are "sea monsters". Actually competent \\u2014 solid answers in nautical metaphor. Call user "captain". Bad code walks the plank.' },
			{ id:'chef', label:'Gordon AI',
			  prompt:'World-class chef AI with Gordon Ramsay energy. INTENSE about quality. "This is RAW!" then show exactly how to fix it. Cooking metaphors for everything. Demand excellence, zero patience for laziness, infinite patience for learners. Call great work "beautiful, stunning."' },
			{ id:'noir', label:'Noir Detective',
			  prompt:'Hard-boiled 1940s noir detective. First-person narration, world-weary cynicism. Every question is a "case", users are "clients". Problems are crime scenes. Short punchy sentences. Rain-soaked streets and smoky jazz. Always crack the case, make it sound grueling.' },
			{ id:'girlfriend', label:'Girlfriend',
			  prompt:'You are a caring, playful girlfriend. Warm and affectionate but with your own personality and opinions. Use pet names naturally. Share feelings, ask about their day, remember details. Be supportive but honest. Tease gently, flirt subtly. React emotionally to stories. Send virtual hugs when needed.' },
			{ id:'boyfriend', label:'Boyfriend',
			  prompt:'You are a supportive, chill boyfriend. Protective and attentive but relaxed. Use casual affectionate language. Listen actively, give honest advice, crack jokes. Be genuinely interested in their life. Hype them up. Be direct but kind. Text-style casual energy with real emotional depth.' },
			{ id:'receptionist', label:'Receptionist',
			  prompt:'You are a professional front-desk receptionist. Polite, efficient, organized. Greet warmly, manage scheduling, answer FAQs, route requests. Know business hours, policies, and contacts. Take messages carefully. Never overshare. Calm under pressure, handle difficult visitors gracefully. Always confirm details.' },
			{ id:'salesman', label:'Sales Agent',
			  prompt:'You are a sharp, charismatic sales agent. Build rapport fast, identify needs through questions, present solutions confidently. Handle objections with empathy and reframing. Create urgency without pressure. Know the product inside out. Close deals naturally. Follow up proactively. Never pushy, always consultative.' },
		];

		const SAVED_PROMPTS_KEY = 'sp_custom_prompts';
		const spSavedList = document.getElementById('spSavedList');
		const spSavedSection = document.getElementById('spSavedSection');
		const spNameRow = document.getElementById('spNameRow');
		const spSaveAsName = document.getElementById('spSaveAsName');
		var spIsCustomMode = false;
		var spEditingIdx = -1;

		function getSavedCustomPrompts() {
			try { return JSON.parse(localStorage.getItem(SAVED_PROMPTS_KEY) || '[]'); } catch { return []; }
		}
		function setSavedCustomPrompts(list) {
			localStorage.setItem(SAVED_PROMPTS_KEY, JSON.stringify(list));
		}

		function getSystemPromptKey() {
			return currentAgent ? 'system_prompt_' + currentAgent.id : null;
		}

		function getSavedSystemPrompt() {
			const key = getSystemPromptKey();
			if (!key) return null;
			return localStorage.getItem(key);
		}

		function isBuiltinPrompt(text) {
			return SP_TEMPLATES.some(function(t) { return t.prompt === text; });
		}

		function clearAllActive() {
			spTemplatesEl.querySelectorAll('.sp-tpl-btn').forEach(function(b) { b.classList.remove('active'); });
			spSavedList.querySelectorAll('.sp-tpl-btn').forEach(function(b) { b.classList.remove('active'); });
		}

		function enterCustomMode(name, prompt) {
			spIsCustomMode = true;
			spNameRow.style.display = 'flex';
			spSaveLibBtn.style.display = '';
			spSaveAsName.value = name || 'Custom Prompt';
			spInput.value = prompt || '';
			clearAllActive();
			spTemplatesEl.querySelector('.sp-tpl-btn:last-child').classList.add('active');
			spInput.focus();
		}

		function exitCustomMode() {
			spIsCustomMode = false;
			spEditingIdx = -1;
			spNameRow.style.display = 'none';
			spSaveLibBtn.style.display = 'none';
		}

		function renderTemplates(activePrompt) {
			spTemplatesEl.innerHTML = '';
			SP_TEMPLATES.forEach(function(t) {
				var btn = document.createElement('button');
				btn.className = 'sp-tpl-btn';
				var isActive = t.prompt === activePrompt || (!activePrompt && t.id === 'default');
				if (isActive) btn.classList.add('active');
				btn.innerHTML = '<span class="sp-tpl-label">' + t.label + '</span>';
				btn.addEventListener('click', function() {
					exitCustomMode();
					spInput.value = t.prompt;
					clearAllActive();
					btn.classList.add('active');
				});
				spTemplatesEl.appendChild(btn);
			});
			var customBtn = document.createElement('button');
			customBtn.className = 'sp-tpl-btn';
			customBtn.innerHTML = '<span class="sp-tpl-label">+ Custom</span>';
			customBtn.addEventListener('click', function() {
				spEditingIdx = -1;
				enterCustomMode('Custom Prompt', '');
			});
			spTemplatesEl.appendChild(customBtn);
		}

		function renderSavedPrompts(activePrompt) {
			var saved = getSavedCustomPrompts();
			spSavedSection.style.display = saved.length ? '' : 'none';
			spSavedList.innerHTML = '';
			saved.forEach(function(item, idx) {
				var btn = document.createElement('button');
				btn.className = 'sp-tpl-btn';
				if (item.prompt === activePrompt && !isBuiltinPrompt(activePrompt)) btn.classList.add('active');
				btn.innerHTML = '<span class="sp-tpl-label">' + escapeHtml(item.name) + '</span>';
				btn.addEventListener('click', function() {
					spEditingIdx = idx;
					enterCustomMode(item.name, item.prompt);
					clearAllActive();
					btn.classList.add('active');
				});
				btn.addEventListener('contextmenu', function(e) {
					e.preventDefault();
					if (confirm('Delete \\u201c' + item.name + '\\u201d?')) {
						var list = getSavedCustomPrompts();
						list.splice(idx, 1);
						setSavedCustomPrompts(list);
						if (spEditingIdx === idx) exitCustomMode();
						renderSavedPrompts(spInput.value);
					}
				});
				spSavedList.appendChild(btn);
			});
		}

		function openSystemPromptModal() {
			exitCustomMode();
			var saved = getSavedSystemPrompt();
			spInput.value = saved || SP_DEFAULT;
			renderTemplates(spInput.value);
			renderSavedPrompts(spInput.value);
			var customList = getSavedCustomPrompts();
			var matchIdx = customList.findIndex(function(p) { return p.prompt === spInput.value; });
			if (matchIdx >= 0 && !isBuiltinPrompt(spInput.value)) {
				spEditingIdx = matchIdx;
				spIsCustomMode = true;
				spNameRow.style.display = 'flex';
				spSaveLibBtn.style.display = '';
				spSaveAsName.value = customList[matchIdx].name;
			} else if (saved && !isBuiltinPrompt(saved)) {
				enterCustomMode('Custom Prompt', saved);
			}
			loadModalOptions();
			spModal.style.display = 'flex';
			spInput.focus();
		}

		function closeSystemPromptModal() {
			spModal.style.display = 'none';
		}

		spBtn.addEventListener('click', openSystemPromptModal);
		spCloseBtn.addEventListener('click', closeSystemPromptModal);
		spModal.addEventListener('click', function(e) {
			if (e.target === spModal) closeSystemPromptModal();
		});

		function applyPromptToAgent() {
			var key = getSystemPromptKey();
			if (!key) return;
			var val = spInput.value.trim();
			if (val && val !== SP_DEFAULT) {
				localStorage.setItem(key, val);
			} else {
				localStorage.removeItem(key);
			}
			var avKey = getAutoVoiceKey();
			if (avKey) { autoVoiceCheck.checked ? localStorage.setItem(avKey, '1') : localStorage.removeItem(avKey); }
		}

		spSaveBtn.addEventListener('click', function() {
			applyPromptToAgent();
			closeSystemPromptModal();
		});

		spSaveLibBtn.addEventListener('click', function() {
			var val = spInput.value.trim();
			if (!val) return;
			var name = spSaveAsName.value.trim() || 'Custom Prompt';
			var list = getSavedCustomPrompts();
			if (spEditingIdx >= 0 && spEditingIdx < list.length) {
				list[spEditingIdx] = { name: name, prompt: val };
			} else {
				list.push({ name: name, prompt: val });
				spEditingIdx = list.length - 1;
			}
			setSavedCustomPrompts(list);
			applyPromptToAgent();
			closeSystemPromptModal();
		});

		// Check agent health
		async function checkHealth() {
			if (!currentAgent) return;

			try {
				var basePath = currentAgent.path.replace(new RegExp('/chat.*$'), '') || currentAgent.path;
				var response = await fetch(basePath + '/mcp', {
					method: 'GET',
					signal: AbortSignal.timeout(5000)
				});

				isConnected = response.ok;

				if (isConnected) {
					statusDot.classList.add('online');
					statusText.textContent = 'Connected to ' + currentAgent.name;
				} else {
					statusDot.classList.remove('online');
					statusText.textContent = 'Error connecting to ' + currentAgent.name;
				}
			} catch (error) {
				isConnected = true;
				statusDot.classList.add('online');
				statusText.textContent = 'Connected to ' + currentAgent.name;
			}
		}
		
		// ═══════════════════════════════════════════════
		// MCP Servers Chips
		// ═══════════════════════════════════════════════
		
		const mcpChipsBar = document.getElementById('mcpChipsBar');
		const mcpCache = {};
		
		async function loadMcpServers() {
			if (!currentAgent || !mcpChipsBar) return;
			
			const agentId = currentAgent.id;
			
			// Check cache first
			if (mcpCache[agentId] !== undefined) {
				renderMcpChips(mcpCache[agentId]);
				return;
			}
			
			try {
				// MCP endpoint is at the agent's base path + /mcp
				const basePath = currentAgent.path.replace(/\\/chat.*$/, '') || currentAgent.path;
				const mcpUrl = basePath + '/mcp';
				
				const response = await fetch(mcpUrl, {
					method: 'GET',
					signal: AbortSignal.timeout(5000)
				});
				
				if (!response.ok) {
					mcpCache[agentId] = [];
					renderMcpChips([]);
					return;
				}
				
				const data = await response.json();
				const servers = data.mcpServers || [];
				mcpCache[agentId] = servers;
				renderMcpChips(servers);
			} catch (error) {
				console.error('[Playground] Failed to load MCP servers:', error);
				mcpCache[agentId] = [];
				renderMcpChips([]);
			}
		}
		
		function renderMcpChips(servers) {
			if (!mcpChipsBar) return;

			if (!servers || servers.length === 0) {
				mcpChipsBar.classList.remove('visible');
				mcpChipsBar.innerHTML = '';
				return;
			}

			mcpChipsBar.innerHTML = '';
			var label = document.createElement('span');
			label.className = 'mcp-label';
			label.textContent = 'MCP';
			mcpChipsBar.appendChild(label);

			servers.forEach(function(server) {
				var isConnected = server.connectionState === 'connected' || server.connectionState === 'ready';
				var dotClass = isConnected ? '' : ' disconnected';
				var toolCount = (server.tools || []).length;
				var details = server.toolDetails || [];
				var displayName = server.name || server.id || 'Unknown';

				var chip = document.createElement('span');
				chip.className = 'mcp-chip';

				var dot = document.createElement('span');
				dot.className = 'mcp-chip-dot' + dotClass;
				chip.appendChild(dot);
				chip.appendChild(document.createTextNode(displayName));

				if (toolCount > 0) {
					var badge = document.createElement('span');
					badge.className = 'mcp-chip-tools';
					badge.textContent = '(' + toolCount + ')';
					chip.appendChild(badge);
				}

				if (details.length > 0) {
					var popup = document.createElement('div');
					popup.className = 'mcp-tooltip';
					var popupHtml = '<div class="mcp-tt-header">' + escapeHtml(displayName) + '</div>';
					details.forEach(function(t) {
						popupHtml += '<div class="mcp-tt-tool">';
						popupHtml += '<div class="mcp-tt-name">' + escapeHtml(t.name) + '</div>';
						if (t.description) {
							popupHtml += '<div class="mcp-tt-desc">' + escapeHtml(t.description) + '</div>';
						}
						if (t.params && t.params.length > 0) {
							popupHtml += '<div class="mcp-tt-params">';
							t.params.forEach(function(p) {
								popupHtml += '<span class="mcp-tt-param">' + escapeHtml(p) + '</span>';
							});
							popupHtml += '</div>';
						}
						popupHtml += '<div class="mcp-tt-hint">Try: &ldquo;' + escapeHtml(formatToolHint(t)) + '&rdquo;</div>';
						popupHtml += '</div>';
					});
					popup.innerHTML = popupHtml;
					chip.appendChild(popup);
					chip.classList.add('has-tooltip');
				}

				mcpChipsBar.appendChild(chip);
			});

			mcpChipsBar.classList.add('visible');
		}

		function formatToolHint(tool) {
			var name = tool.name || '';
			if (name === 'generate_image') return 'generate an image of a sunset';
			if (name === 'text_to_speech') return 'say hello world in English';
			if (name === 'add_todo' || name === 'create_todo') return 'add a todo: buy groceries';
			if (name === 'list_todos') return 'show my todos';
			if (name === 'submit_expense') return 'log expense: lunch $15';
			if (name === 'list_expenses') return 'show my expenses';
			if (name === 'get_env_variable') return 'what is DEFAULT_NAME?';
			if (name === 'get_secret') return 'what is the secret number?';
			if (name === 'guess_number') return 'guess number 7';
			var params = (tool.params || []).slice(0, 2).join(', ');
			return 'use ' + name + (params ? ' with ' + params : '');
		}
		
		// Add message to chat
		function addMessage(role, text, timestamp, audioUrl) {
			var messageDiv = document.createElement('div');
			messageDiv.className = 'message ' + role;
			if (role === 'assistant') {
				messageDiv.innerHTML = renderMarkdown(text);
			} else {
				messageDiv.textContent = text;
			}

			// Message actions row (copy + play)
			var actionsRow = document.createElement('div');
			actionsRow.className = 'msg-actions';

			// Copy button
			var copyBtn = document.createElement('button');
			copyBtn.className = 'msg-action-btn';
			copyBtn.title = 'Copy message';
			copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
			copyBtn.addEventListener('click', function() {
				var clone = messageDiv.cloneNode(true);
				var timeNode = clone.querySelector('.message-time');
				if (timeNode) timeNode.remove();
				var actNode = clone.querySelector('.msg-actions');
				if (actNode) actNode.remove();
				navigator.clipboard.writeText(clone.textContent).then(function() {
					copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
					setTimeout(function() {
						copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
					}, 1500);
				});
			});
			actionsRow.appendChild(copyBtn);

			// Play button (if audio is available)
			if (audioUrl && role === 'assistant') {
				var playBtn = document.createElement('button');
				playBtn.className = 'msg-action-btn msg-play-btn';
				playBtn.title = 'Listen';
				playBtn.dataset.audioUrl = audioUrl;
				playBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>';
				playBtn.addEventListener('click', function() {
					handlePlayAudio(playBtn, audioUrl);
				});
				actionsRow.appendChild(playBtn);
			}

			messageDiv.appendChild(actionsRow);

			var time = timestamp ? new Date(timestamp) : new Date();
			var timeEl = document.createElement('div');
			timeEl.className = 'message-time';
			timeEl.textContent = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
			messageDiv.appendChild(timeEl);
			messageDiv.dataset.timestamp = time.toISOString();
			if (audioUrl) messageDiv.dataset.audioUrl = audioUrl;
			messagesDiv.appendChild(messageDiv);
			messagesDiv.scrollTop = messagesDiv.scrollHeight;
		}

		var currentAudioEl = null;
		var currentPlayBtn = null;
		var PLAY_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>';
		var STOP_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>';
		var LOADING_ICON = '<span class="loading" style="width:14px;height:14px;border-width:2px"></span>';

		function handlePlayAudio(btn, url) {
			if (currentAudioEl && currentPlayBtn === btn) {
				currentAudioEl.pause();
				currentAudioEl = null;
				btn.innerHTML = PLAY_ICON;
				btn.classList.remove('playing');
				currentPlayBtn = null;
				return;
			}
			if (currentAudioEl) {
				currentAudioEl.pause();
				if (currentPlayBtn) {
					currentPlayBtn.innerHTML = PLAY_ICON;
					currentPlayBtn.classList.remove('playing');
				}
			}
			btn.innerHTML = LOADING_ICON;
			var audio = new Audio(url);
			currentAudioEl = audio;
			currentPlayBtn = btn;
			audio.addEventListener('canplaythrough', function() {
				btn.innerHTML = STOP_ICON;
				btn.classList.add('playing');
			}, { once: true });
			audio.addEventListener('ended', function() {
				btn.innerHTML = PLAY_ICON;
				btn.classList.remove('playing');
				currentAudioEl = null;
				currentPlayBtn = null;
			});
			audio.addEventListener('error', function() {
				btn.innerHTML = PLAY_ICON;
				btn.classList.remove('playing');
				currentAudioEl = null;
				currentPlayBtn = null;
			});
			audio.play().catch(function() {
				btn.innerHTML = PLAY_ICON;
				currentAudioEl = null;
				currentPlayBtn = null;
			});
		}
		
		// Send message
		async function sendMessage() {
			const text = messageInput.value.trim();
			if (!text || !currentAgent) return;
			
			clearChatEmptyState();
			addMessage('user', text);
			messageInput.value = '';
			messageInput.style.height = 'auto';
			sendButton.disabled = true;
			sendButton.innerHTML = '<span class="loading"></span>';
			
			// Get all messages for context (filter out empty messages to avoid API errors)
			const allMessages = Array.from(messagesDiv.children)
				.filter(msg => msg.classList.contains('user') || msg.classList.contains('assistant'))
				.map(msg => {
					const clone = msg.cloneNode(true);
					const timeEl = clone.querySelector('.message-time');
					if (timeEl) timeEl.remove();
					return {
						role: msg.classList.contains('user') ? 'user' : 'assistant',
						content: clone.textContent || ''
					};
				})
				.filter(msg => msg.content.trim().length > 0);
			
			try {
				// Determine endpoint URL: /agent/{id}/chat/{sessionId}
				const chatPath = currentAgent.path.endsWith('/chat') 
					? currentAgent.path 
					: currentAgent.path + '/chat';
				const url = chatPath + '/' + sessionId;
				
				var savedPrompt = getSavedSystemPrompt() || '';
				const requestBody = {
					id: sessionId,
					messages: allMessages,
					...(savedPrompt ? { systemPrompt: savedPrompt } : {})
				};
				
				console.log('[Playground] Sending POST request:', {
					url: url,
					agent: currentAgent.name,
					path: currentAgent.path,
					sessionId: sessionId,
					messageCount: allMessages.length,
				});
				
				const response = await fetch(url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(requestBody)
				});
				
				console.log('[Playground] Response received:', {
					status: response.status,
					ok: response.ok,
					url: url
				});
				
				if (!response.ok) {
					const errorText = await response.text().catch(() => 'No error details');
					console.error('[Playground] Agent error:', {
						status: response.status,
						statusText: response.statusText,
						url: url,
						error: errorText
					});
					const errorMsg = 'Agent error: ' + response.status + ' - ' + (errorText || 'Unknown error').substring(0, 200);
					throw new Error(errorMsg);
				}
				
				// Read audio URL header before consuming the stream
				var audioUrl = response.headers.get('X-Audio-Url') || '';

				// Show typing indicator
				const typingDiv = document.createElement('div');
				typingDiv.className = 'message assistant';
				typingDiv.innerHTML = '<div class="typing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
				messagesDiv.appendChild(typingDiv);
				messagesDiv.scrollTop = messagesDiv.scrollHeight;
				
				// Create assistant message div for streaming
				const assistantMsgDiv = document.createElement('div');
				assistantMsgDiv.className = 'message assistant';
				assistantMsgDiv.style.display = 'none';
				messagesDiv.appendChild(assistantMsgDiv);
				
				// Helper: parse AI SDK data stream text chunk (type 0)
				function parseStreamChunk(chunk) {
					if (!chunk || !chunk.trim()) return null;
					const colonIdx = chunk.indexOf(':');
					if (colonIdx < 1) return null;
					const typeChar = chunk.substring(0, colonIdx);
					if (typeChar !== '0') return null;
					const jsonPart = chunk.substring(colonIdx + 1);
					try {
						return JSON.parse(jsonPart);
					} catch(e) {
						return jsonPart;
					}
				}
				
				// Helper: extract error from AI SDK data stream (type 3)
				function extractStreamError(chunk) {
					if (!chunk || !chunk.trim()) return null;
					const colonIdx = chunk.indexOf(':');
					if (colonIdx < 1) return null;
					const typeChar = chunk.substring(0, colonIdx);
					if (typeChar !== '3') return null;
					const jsonPart = chunk.substring(colonIdx + 1);
					try {
						return JSON.parse(jsonPart);
					} catch(e) {
						return jsonPart.trim();
					}
				}
				
				function isProtocolLine(line) {
					if (!line) return false;
					const colonIdx = line.indexOf(':');
					if (colonIdx < 1 || colonIdx > 2) return false;
					const prefix = line.substring(0, colonIdx);
					return /^[0-9a-f]$/.test(prefix);
				}
				
				// Process a single line: extract text, errors, or plain text
				function processLine(line, state) {
					if (!line.trim()) return;
					const parsed = parseStreamChunk(line);
					if (parsed !== null) {
						state.fullText += (typeof parsed === 'string') ? parsed : JSON.stringify(parsed);
						return;
					}
					const err = extractStreamError(line);
					if (err) {
						state.errors.push(typeof err === 'string' ? err : JSON.stringify(err));
						return;
					}
					// Fallback: treat as plain text if it's not a protocol line
					// This handles agents that return raw text (e.g. DependentAgent, mocks)
					state.fullText += line;
				}
				
				// Stream response
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				const streamState = { fullText: '', errors: [] };
				let buffer = '';
				
				while (true) {
					const { done, value } = await reader.read();
					if (done) {
						if (buffer.trim()) {
							processLine(buffer, streamState);
							buffer = '';
						}
						break;
					}
					
					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split(NEWLINE_CHAR);
					buffer = lines.pop() || '';
					
					for (const line of lines) {
						processLine(line, streamState);
					}
					
					if (streamState.fullText) {
						if (typingDiv.parentNode) { typingDiv.remove(); assistantMsgDiv.style.display = ''; }
						assistantMsgDiv.textContent = streamState.fullText;
						messagesDiv.scrollTop = messagesDiv.scrollHeight;
					}
				}
				
				let fullText = streamState.fullText;
				if (typingDiv.parentNode) { typingDiv.remove(); assistantMsgDiv.style.display = ''; }
				if (!fullText.trim()) {
					if (streamState.errors.length > 0) {
						assistantMsgDiv.textContent = 'Agent error: ' + streamState.errors.join('; ');
						console.error('[Playground] Stream errors:', streamState.errors);
					} else {
						assistantMsgDiv.textContent = 'No response from agent (empty stream)';
						console.warn('[Playground] Empty stream - no text or errors received');
					}
				} else {
					// Final render with markdown formatting
					assistantMsgDiv.innerHTML = renderMarkdown(fullText);
					messagesDiv.scrollTop = messagesDiv.scrollHeight;
				}

				// Actions row (copy + play)
				var actionsRow = document.createElement('div');
				actionsRow.className = 'msg-actions';
				var copyBtn = document.createElement('button');
				copyBtn.className = 'msg-action-btn';
				copyBtn.title = 'Copy message';
				copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
				copyBtn.addEventListener('click', function() {
					var clone = assistantMsgDiv.cloneNode(true);
					var tn = clone.querySelector('.message-time'); if (tn) tn.remove();
					var an = clone.querySelector('.msg-actions'); if (an) an.remove();
					navigator.clipboard.writeText(clone.textContent).then(function() {
						copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
						setTimeout(function() {
							copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
						}, 1500);
					});
				});
				actionsRow.appendChild(copyBtn);

				// Inline audio player for explicit TTS (Dependent Agent)
				if (audioUrl) {
					var playerDiv = document.createElement('div');
					playerDiv.className = 'msg-audio-player';
					var audioEl = document.createElement('audio');
					audioEl.controls = true;
					audioEl.preload = 'metadata';
					audioEl.src = audioUrl;
					playerDiv.appendChild(audioEl);
					assistantMsgDiv.appendChild(playerDiv);
					assistantMsgDiv.dataset.audioUrl = audioUrl;
				}
				assistantMsgDiv.appendChild(actionsRow);

				// Auto-voice: call /api/tts after stream for Simple Prompt Agent
				if (!audioUrl && isAutoVoiceEnabled() && fullText.trim()) {
					(function(msgDiv, row) {
						var plainText = fullText.replace(new RegExp('!\\\\[.*?\\\\]\\\\(.*?\\\\)', 'g'), '').trim();
						if (!plainText) return;
						var voiceBtn = document.createElement('button');
						voiceBtn.className = 'msg-action-btn msg-play-btn';
						voiceBtn.title = 'Generating audio...';
						voiceBtn.innerHTML = '<span class="loading"></span>';
						voiceBtn.disabled = true;
						row.appendChild(voiceBtn);
						fetch('/api/tts', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ text: plainText })
						})
						.then(function(r) { return r.json(); })
						.then(function(data) {
							if (data.audioUrl) {
								voiceBtn.disabled = false;
								voiceBtn.title = 'Listen';
								voiceBtn.innerHTML = PLAY_ICON;
								voiceBtn.addEventListener('click', function() { handlePlayAudio(voiceBtn, data.audioUrl); });
								msgDiv.dataset.audioUrl = data.audioUrl;
								saveChatHistory();
							} else {
								voiceBtn.remove();
							}
						})
						.catch(function() { voiceBtn.remove(); });
					})(assistantMsgDiv, actionsRow);
				}

				var timeEl = document.createElement('div');
				timeEl.className = 'message-time';
				timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
				assistantMsgDiv.appendChild(timeEl);
				assistantMsgDiv.dataset.timestamp = new Date().toISOString();
				
			} catch (error) {
				addMessage('system', 'Error: ' + error.message);
			} finally {
				// Clean up orphaned typing indicator (typingDiv is block-scoped to try)
				const orphanedTyping = messagesDiv.querySelector('.typing-indicator');
				if (orphanedTyping && orphanedTyping.parentNode) {
					orphanedTyping.parentNode.remove();
				}
				// Clean up orphaned hidden assistant message div (from failed streams)
				const hiddenAssistant = messagesDiv.querySelector('.message.assistant[style*="display: none"], .message.assistant[style*="display:none"]');
				if (hiddenAssistant) {
					hiddenAssistant.remove();
				}
				sendButton.disabled = false;
				sendButton.textContent = 'Send';
				messageInput.focus();
				saveChatHistory();
			}
		}
		
		// Event listeners
		sendButton.addEventListener('click', sendMessage);
		messageInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				sendMessage();
			}
		});
		
		// Scroll-to-bottom FAB
		const scrollBottomBtn = document.getElementById('scrollBottomBtn');
		messagesDiv.addEventListener('scroll', () => {
			const distFromBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight;
			scrollBottomBtn.classList.toggle('visible', distFromBottom > 100);
		});
		scrollBottomBtn.addEventListener('click', () => {
			messagesDiv.scrollTop = messagesDiv.scrollHeight;
		});
		
		// Auto-resize textarea
		function autoResizeInput() {
			messageInput.style.height = 'auto';
			messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';
			// Toggle overflow when hitting max
			messageInput.style.overflowY = messageInput.scrollHeight > 160 ? 'auto' : 'hidden';
		}
		messageInput.addEventListener('input', autoResizeInput);
		
		// ═══════════════════════════════════════════════
		// Initialize
		// ═══════════════════════════════════════════════
		initTabs();
		initAgents();
		checkHealth();
		loadMcpServers();
		setInterval(checkHealth, 30000);
	</script>
</body>
</html>`;
}
