/**
 * Playground CSS Styles
 * Dark theme with CSS custom properties for theming
 */

export function generateStyles(primaryColor: string, secondaryColor: string): string {
	return `
		:root {
			/* ── Surface / Background ── */
			--bg-base: #0f0f0f;
			--bg-surface: #1a1a1a;
			--bg-card: #1e1e1e;
			--bg-input: #252525;
			--bg-elevated: #303030;
			--bg-sidebar: #0a0a0a;
			--bg-inset: #151515;
			/* ── Text ── */
			--text-primary: #ffffff;
			--text-secondary: #d0d0d0;
			--text-tertiary: #a0a0a0;
			--text-muted: #666666;
			--text-faint: #444444;
			--text-disabled: #888888;
			--text-on-accent: #000000;
			/* ── Accent ── */
			--accent: ${primaryColor};
			--accent-hover: ${secondaryColor};
			--accent-subtle: rgba(0,212,170,0.15);
			--accent-muted: rgba(0,212,170,0.14);
			--accent-faint: rgba(0,212,170,0.08);
			--accent-ghost: rgba(0,212,170,0.05);
			--accent-glow: rgba(0,212,170,0.3);
			--accent-glow-sm: rgba(0,212,170,0.15);
			--danger-border: rgba(255,100,80,0.3);
			--danger-bg: rgba(255,100,80,0.2);
			--danger-bg-faint: rgba(255,100,80,0.1);
			/* ── Semantic ── */
			--success: #00d96f;
			--danger: #ff6450;
			--warning: #ffc832;
			--purple: #a78bfa;
			/* ── Border ── */
			--border-subtle: rgba(255,255,255,0.05);
			--border-light: rgba(255,255,255,0.08);
			--border-medium: rgba(255,255,255,0.1);
			--border-strong: rgba(255,255,255,0.12);
			/* ── Shadow ── */
			--shadow-card: 0 2px 8px rgba(0,0,0,0.2);
			--shadow-elevated: 0 4px 12px rgba(0,0,0,0.3);
			--shadow-modal: 0 20px 60px rgba(0,0,0,0.5);
		}

		* { margin: 0; padding: 0; box-sizing: border-box; }

		/* ── Scrollbar ──────────────────────────────────── */
		::-webkit-scrollbar { width: 5px; height: 5px; }
		::-webkit-scrollbar-track { background: transparent; }
		::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 5px; transition: background 0.2s; }
		::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.18); }
		* { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.08) transparent; }

		/* ── Selection ─────────────────────────────────── */
		::selection { background: rgba(99,102,241,0.35); color: #fff; }
		::-moz-selection { background: rgba(99,102,241,0.35); color: #fff; }

		/* ── Inline code ───────────────────────────────── */
		code {
			font-family: monospace;
			font-size: 0.9em;
			padding: 2px 6px;
			background: var(--bg-elevated);
			border-radius: 4px;
			color: var(--accent);
		}

		/* ── Selection ──────────────────────────────────── */
		::selection { background: color-mix(in srgb, var(--accent) 35%, transparent); color: var(--text-primary); }

		/* ── Focus visible ──────────────────────────────── */
		:focus-visible {
			outline: 2px solid var(--accent);
			outline-offset: 2px;
		}
		input:focus-visible, textarea:focus-visible, select:focus-visible {
			outline: none;
		}

		/* ── Utility classes for inline-style dedup ────── */
		.label-upper { font-size: 12px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 6px; }
		.field-label { font-size: 12px; font-weight: 600; color: var(--text-tertiary); display: block; margin-bottom: 4px; }
		.hint-text { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
		.section-desc { font-size: 13px; color: var(--text-tertiary); margin-bottom: 12px; }
		.mono-val { font-family: monospace; font-size: 13px; color: var(--text-tertiary); }
		.grid-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
		.flex-row { display: flex; gap: 8px; align-items: center; }
		.flex-between { display: flex; justify-content: space-between; align-items: center; }
		.section-block { margin-bottom: 12px; }
		.empty-msg { text-align: center; color: var(--text-muted); font-size: 13px; padding: 12px; }
		.btn-sm { font-size: 11px; padding: 6px 12px; min-height: 28px; }
		.btn-icon { padding: 6px 10px; font-size: 11px; min-height: 28px; }
		.text-danger { color: var(--danger); }
		.text-muted-sm { font-size: 12px; color: var(--text-muted); }
		.pin-input { width: 180px; text-align: center; font-size: 24px; letter-spacing: 8px; padding: 14px; border-radius: 10px; border: 1px solid var(--border-medium); background: var(--bg-input); color: var(--text-primary); outline: none; font-family: monospace; transition: border-color 0.2s; }
		.pin-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 13%, transparent); }
		.pin-btn { margin-top: 16px; padding: 12px 36px; border-radius: 10px; border: none; background: var(--accent); color: var(--text-on-accent); font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
		.pin-btn:hover { background: var(--accent-hover); }
		.pin-btn:disabled { opacity: 0.6; cursor: not-allowed; }
		.centered-panel { display: flex; align-items: center; justify-content: center; height: 100%; min-height: 300px; }
		.centered-panel-inner { text-align: center; max-width: 340px; width: 100%; }
		.centered-panel-inner h2 { margin: 0 0 8px; color: var(--text-primary); font-size: 20px; }
		.centered-panel-inner p { color: var(--text-tertiary); font-size: 13px; margin: 0 0 20px; line-height: 1.5; }
		.link-btn-subtle { margin-top: 8px; padding: 6px 16px; display: block; margin-left: auto; margin-right: auto; border-radius: 6px; border: none; background: transparent; color: var(--text-muted); font-size: 12px; cursor: pointer; transition: color 0.15s; }
		.link-btn-subtle:hover { color: var(--text-secondary); }
		.input-wide { width: 100%; text-align: left; max-width: none; }
		.icon-circle { width: 48px; height: 48px; border-radius: 50%; background: var(--accent-subtle); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }
		.icon-circle-sm { width: 40px; height: 40px; border-radius: 50%; background: var(--accent-subtle); display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; }
		.text-muted-xs { font-size: 11px; color: var(--text-muted); }
		.text-tertiary-sm { font-size: 12px; color: var(--text-tertiary); }
		.btn-danger-outline { color: var(--danger); border-color: var(--danger-border); }
		.btn-danger-outline:hover { background: var(--danger-bg-faint); }
		.error-msg { color: var(--danger); font-size: 13px; }
		.dash-card-flat { box-shadow: none; border: 1px solid var(--border-subtle); }
		.schedule-info-box { margin-bottom: 12px; padding: 8px 12px; background: var(--accent-faint); border-radius: 8px; font-size: 12px; color: var(--accent); }
		.post-preview-box { padding: 12px; background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: 8px; font-size: 13px; white-space: pre-wrap; margin-bottom: 12px; max-height: 200px; overflow-y: auto; }
		.approval-empty-box { padding: 12px; background: var(--bg-input); border-radius: 8px; margin-bottom: 12px; }
		.highlight-box { padding: 12px 16px; background: var(--accent-faint); border-radius: 10px; }
		.badge-micro { font-size: 9px; padding: 1px 5px; margin-right: 4px; vertical-align: middle; }
		.auto-approve-hint { margin-top: 4px; margin-left: 24px; }
		.break-word { overflow-wrap: break-word; min-width: 0; }
		.non-interactive { cursor: default; pointer-events: none; }
		.td-truncate { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.label-upper-spaced { margin-top: 12px; margin-bottom: 8px; }
		.label-upper-spaced-lg { margin-top: 16px; margin-bottom: 8px; }
		.select-all-label { font-size: 12px; cursor: pointer; color: var(--accent); display: inline-flex; align-items: center; gap: 4px; }

		body {
			font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			background: var(--bg-base);
			min-height: 100vh;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 20px;
			color: var(--text-secondary);
		}
		.container {
			background: var(--bg-surface);
			border-radius: 16px;
			box-shadow: var(--shadow-modal);
			width: 100%;
			max-width: 1100px;
			height: min(700px, calc(100vh - 40px));
			display: flex;
			flex-direction: column;
			overflow: hidden;
			border: 1px solid var(--border-subtle);
		}
		.header {
			background: var(--bg-sidebar);
			color: var(--text-primary);
			padding: 16px 20px;
			display: flex;
			flex-direction: column;
			gap: 8px;
			border-bottom: 1px solid var(--border-light);
		}
		.header-top {
			display: flex;
			justify-content: space-between;
			align-items: center;
			flex-wrap: wrap;
			gap: 12px;
		}
		.header h1 { font-size: 20px; margin: 0; font-weight: 700; }
		.agent-selector {
			display: flex;
			gap: 8px;
			align-items: center;
			flex-wrap: wrap;
		}
		.agent-selector select {
			padding: 6px 12px;
			border: 1px solid var(--border-strong);
			border-radius: 8px;
			background: var(--bg-card);
			color: var(--text-secondary);
			font-size: 13px;
			cursor: pointer;
			min-width: 140px;
			max-width: 280px;
		}
		.agent-selector select:focus {
			outline: none;
			border-color: var(--accent);
		}
		.action-btn {
			padding: 8px 14px;
			border: 1px solid var(--border-strong);
			border-radius: 8px;
			background: var(--bg-card);
			color: var(--text-secondary);
			font-size: 12px;
			cursor: pointer;
			transition: all 0.2s;
			min-height: 34px;
		}
		.action-btn:hover {
			background: var(--bg-input);
			border-color: rgba(255,255,255,0.2);
		}
		.action-btn.danger {
			color: var(--danger);
			border-color: var(--danger-border);
		}
		.action-btn.danger:hover {
			background: var(--danger-bg-faint);
		}
		.status {
			font-size: 12px;
			opacity: 0.9;
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 8px;
			color: var(--text-tertiary);
		}
		.status-dot {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: var(--danger);
			animation: pulse 2s infinite;
		}
		.status-dot.online { background: var(--success); }
		@keyframes pulse {
			0%, 100% { opacity: 1; }
			50% { opacity: 0.5; }
		}

		/* ── MCP Chips Bar ─────────────────────────────── */
		.mcp-chips-bar {
			display: none;
			align-items: center;
			gap: 6px;
			padding: 0 16px 10px;
			flex-wrap: wrap;
		}
		.mcp-chips-bar.visible {
			display: flex;
		}
		.sp-modal-options {
			display: flex;
			gap: 20px;
			padding: 0 24px 16px;
		}
		.sp-option-toggle {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			cursor: pointer;
			font-size: 13px;
			color: var(--text-tertiary);
			user-select: none;
		}
		.sp-option-toggle input[type="checkbox"] {
			width: 15px;
			height: 15px;
			accent-color: var(--accent);
			cursor: pointer;
			margin: 0;
		}
		.sp-option-toggle:hover { color: var(--text-secondary); }
		.sp-option-toggle span { line-height: 1; }
		.mcp-chips-bar .mcp-label {
			font-size: 11px;
			color: var(--text-muted);
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.03em;
			margin-right: 2px;
			flex-shrink: 0;
		}
		.mcp-chip {
			display: inline-flex;
			align-items: center;
			gap: 5px;
			padding: 3px 10px;
			border-radius: 12px;
			font-size: 11px;
			font-weight: 500;
			font-family: monospace;
			background: var(--accent-faint);
			color: var(--accent);
			border: 1px solid var(--accent-subtle);
			cursor: default;
			transition: all 0.2s;
			white-space: nowrap;
		}
		.mcp-chip:hover {
			background: var(--accent-muted);
			border-color: var(--accent-glow);
		}
		.mcp-chip .mcp-chip-dot {
			width: 6px;
			height: 6px;
			border-radius: 50%;
			background: var(--success);
			flex-shrink: 0;
		}
		.mcp-chip .mcp-chip-dot.disconnected {
			background: var(--danger);
		}
		.mcp-chip .mcp-chip-tools {
			font-size: 10px;
			color: var(--text-muted);
			font-weight: 400;
			font-family: inherit;
		}
		.mcp-chip.has-tooltip {
			position: relative;
			cursor: pointer;
		}
		.mcp-tooltip {
			display: none;
			position: absolute;
			top: calc(100% + 8px);
			left: 50%;
			transform: translateX(-50%);
			z-index: 1000;
			background: var(--bg-card);
			border: 1px solid var(--border-light);
			border-radius: 10px;
			padding: 10px 0;
			min-width: 280px;
			max-width: 360px;
			box-shadow: 0 12px 40px rgba(0,0,0,0.5);
			white-space: normal;
		}
		.mcp-tooltip::before {
			content: '';
			position: absolute;
			top: -5px;
			left: 50%;
			transform: translateX(-50%) rotate(45deg);
			width: 10px;
			height: 10px;
			background: var(--bg-card);
			border-left: 1px solid var(--border-light);
			border-top: 1px solid var(--border-light);
		}
		.mcp-chip.has-tooltip:hover .mcp-tooltip {
			display: block;
		}
		.mcp-tt-header {
			font-size: 11px;
			font-weight: 600;
			color: var(--accent);
			text-transform: uppercase;
			letter-spacing: 0.5px;
			padding: 0 12px 6px;
			border-bottom: 1px solid var(--border-light);
			margin-bottom: 4px;
		}
		.mcp-tt-tool {
			padding: 6px 12px;
			border-bottom: 1px solid rgba(255,255,255,0.03);
		}
		.mcp-tt-tool:last-child { border-bottom: none; }
		.mcp-tt-name {
			font-size: 12px;
			font-weight: 600;
			color: var(--text-primary);
			font-family: monospace;
		}
		.mcp-tt-desc {
			font-size: 11px;
			color: var(--text-secondary);
			margin-top: 2px;
			line-height: 1.3;
		}
		.mcp-tt-params {
			display: flex;
			flex-wrap: wrap;
			gap: 4px;
			margin-top: 4px;
		}
		.mcp-tt-param {
			font-size: 10px;
			font-family: monospace;
			background: rgba(255,255,255,0.05);
			border: 1px solid rgba(255,255,255,0.08);
			border-radius: 4px;
			padding: 1px 5px;
			color: var(--text-tertiary);
		}
		.mcp-tt-hint {
			font-size: 10px;
			color: var(--accent);
			margin-top: 4px;
			font-style: italic;
			opacity: 0.8;
		}

		/* ── Tab Bar ────────────────────────────────────── */
		.tab-bar {
			display: flex;
			background: rgba(255,255,255,0.02);
			border-bottom: 1px solid var(--border-light);
			overflow-x: auto;
			-webkit-overflow-scrolling: touch;
			scrollbar-width: none;
		}
		.tab-bar::-webkit-scrollbar { display: none; }
		.tab-btn {
			padding: 10px 20px;
			background: transparent;
			color: rgba(255,255,255,0.5);
			border: none;
			border-bottom: 3px solid transparent;
			font-size: 13px;
			font-weight: 500;
			cursor: pointer;
			transition: all 0.2s;
			display: flex;
			align-items: center;
			gap: 6px;
			white-space: nowrap;
			flex-shrink: 0;
		}
		.tab-btn:hover {
			color: rgba(255,255,255,0.8);
			background: rgba(255,255,255,0.03);
		}
		.tab-btn.active {
			color: var(--accent);
			border-bottom-color: var(--accent);
			background: rgba(255,255,255,0.03);
		}

		/* ── Tab Content ────────────────────────────────── */
		.tab-content {
			flex: 1;
			flex-direction: column;
			overflow: hidden;
			opacity: 0;
			position: absolute;
			width: 0;
			height: 0;
			pointer-events: none;
			transition: opacity 0.2s ease;
		}
		.tab-content.visible {
			display: flex;
			position: relative;
			width: auto;
			height: auto;
			pointer-events: auto;
		}
		.tab-content.active {
			display: flex;
			position: relative;
			width: auto;
			height: auto;
			pointer-events: auto;
			opacity: 1;
		}

		/* ── Chat Tab ───────────────────────────────────── */
		.chat-header-bar {
			display: flex;
			flex-direction: column;
			background: var(--bg-inset);
			border-bottom: 1px solid var(--border-light);
		}
		.messages {
			flex: 1;
			overflow-y: auto;
			padding: 20px;
			display: flex;
			flex-direction: column;
			gap: 12px;
			background: var(--bg-base);
			scroll-behavior: smooth;
		}
		.message {
			padding: 12px 16px;
			border-radius: 12px;
			max-width: 80%;
			word-wrap: break-word;
			overflow-wrap: break-word;
			white-space: pre-wrap;
			font-size: 14px;
			line-height: 1.5;
			min-width: 0;
		}
		.message.user {
			background: var(--accent);
			color: var(--text-on-accent);
			align-self: flex-end;
			font-weight: 500;
		}
		.message.assistant {
			background: var(--bg-card);
			color: var(--text-secondary);
			align-self: flex-start;
			border: 1px solid var(--border-subtle);
		}
		.message { position: relative; }
		.msg-actions {
			display: flex;
			gap: 4px;
			position: absolute;
			top: 4px;
			right: 4px;
			opacity: 0;
			transition: opacity 0.15s;
		}
		.message:hover .msg-actions { opacity: 1; }
		.msg-action-btn {
			width: 26px;
			height: 26px;
			border-radius: 6px;
			background: var(--bg-card);
			border: 1px solid var(--border-light);
			color: var(--text-muted);
			display: flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
			transition: all 0.15s;
			padding: 0;
		}
		.msg-action-btn:hover { background: var(--bg-elevated); color: var(--text-secondary); }
		.msg-play-btn { color: var(--accent); border-color: rgba(77,208,187,0.3); }
		.msg-play-btn:hover { background: rgba(77,208,187,0.1); color: var(--accent); }
		.msg-play-btn.playing { background: rgba(77,208,187,0.15); color: var(--accent); border-color: var(--accent); }
		.msg-audio-player { margin: 12px 0 8px 0; padding: 8px 0; }
		.msg-audio-player audio { width: 100%; max-width: 360px; height: 40px; border-radius: 20px; }
		.message-time {
			font-size: 10px;
			color: var(--text-faint);
			margin-top: 4px;
			opacity: 0;
			transition: opacity 0.15s;
		}
		.message:hover .message-time { opacity: 1; }
		.message.user .message-time { text-align: right; color: rgba(0,0,0,0.35); }
		.message.system {
			background: var(--accent-faint);
			color: var(--accent);
			align-self: center;
			font-size: 12px;
			border: 1px solid var(--accent-subtle);
		}
		.input-area {
			padding: 20px;
			border-top: 1px solid var(--border-light);
			display: flex;
			gap: 12px;
			background: var(--bg-surface);
		}
		.input-area textarea {
			flex: 1;
			padding: 12px 16px;
			border: 1px solid var(--border-medium);
			border-radius: 20px;
			font-size: 14px;
			font-family: inherit;
			outline: none;
			transition: border-color 0.2s;
			background: var(--bg-base);
			color: var(--text-primary);
			resize: none;
			overflow-y: hidden;
			min-height: 44px;
			max-height: 160px;
			line-height: 1.4;
			box-sizing: border-box;
		}
		.input-area textarea:focus {
			border-color: var(--accent);
		}
		.input-area textarea::placeholder {
			color: var(--text-muted);
		}
		.input-area button {
			padding: 12px 24px;
			background: var(--accent);
			color: var(--text-on-accent);
			border: none;
			border-radius: 24px;
			font-size: 14px;
			font-weight: 600;
			cursor: pointer;
			transition: all 0.2s;
		}
		.input-area button:hover:not(:disabled) {
			background: var(--accent-hover);
		}
		.input-area button:disabled {
			opacity: 0.6;
			cursor: not-allowed;
		}
		.loading {
			display: inline-block;
			width: 12px;
			height: 12px;
			border: 2px solid var(--text-on-accent);
			border-top-color: transparent;
			border-radius: 50%;
			animation: spin 0.6s linear infinite;
		}
		@keyframes spin {
			to { transform: rotate(360deg); }
		}
		.typing-indicator {
			display: flex;
			gap: 4px;
			align-items: center;
			padding: 12px 16px;
		}
		.typing-indicator .dot {
			width: 6px;
			height: 6px;
			background: var(--text-muted);
			border-radius: 50%;
			animation: typingBounce 1.4s ease-in-out infinite;
		}
		.typing-indicator .dot:nth-child(2) { animation-delay: 0.2s; }
		.typing-indicator .dot:nth-child(3) { animation-delay: 0.4s; }
		@keyframes typingBounce {
			0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
			30% { transform: translateY(-4px); opacity: 1; }
		}
		/* ── Markdown in messages ── */
		.message.assistant code {
			font-family: monospace;
			font-size: 0.88em;
			padding: 2px 5px;
			background: rgba(255,255,255,0.06);
			border-radius: 4px;
			color: var(--accent);
		}
		.message.assistant pre.md-codeblock {
			position: relative;
			background: var(--bg-sidebar);
			border: 1px solid var(--border-subtle);
			border-radius: 8px;
			padding: 12px 14px;
			margin: 8px 0;
			overflow-x: auto;
			line-height: 1.5;
		}
		.message.assistant pre.md-codeblock code {
			background: none;
			padding: 0;
			color: var(--text-secondary);
			font-size: 12px;
		}
		.md-lang {
			position: absolute;
			top: 6px;
			left: 10px;
			font-size: 10px;
			color: var(--text-faint);
			text-transform: uppercase;
			letter-spacing: 0.05em;
			font-family: inherit;
			pointer-events: none;
		}
		.md-copy-btn {
			position: absolute;
			top: 6px;
			right: 6px;
			padding: 4px 8px;
			font-size: 11px;
			font-family: inherit;
			background: var(--bg-elevated);
			color: var(--text-muted);
			border: 1px solid var(--border-medium);
			border-radius: 5px;
			cursor: pointer;
			opacity: 0;
			transition: opacity 0.15s, background 0.15s;
			z-index: 1;
			line-height: 1;
		}
		pre.md-codeblock:hover .md-copy-btn { opacity: 1; }
		.md-copy-btn:hover { background: var(--bg-input); color: var(--text-secondary); }
		.md-copy-btn.copied { color: var(--success); border-color: rgba(0,217,111,0.3); }
		.message.assistant del { opacity: 0.6; }
		.message.assistant .md-hr {
			border: none;
			border-top: 1px solid var(--border-light);
			margin: 10px 0;
		}
		.message.assistant .md-blockquote {
			border-left: 3px solid var(--accent);
			margin: 8px 0;
			padding: 4px 12px;
			color: var(--text-tertiary);
			font-style: italic;
			background: var(--accent-ghost);
			border-radius: 0 6px 6px 0;
			white-space: pre-wrap;
		}
		.message.assistant strong { color: var(--text-primary); font-weight: 600; }
		.message.assistant .md-h1 { display: block; font-size: 16px; margin: 8px 0 4px; color: var(--text-primary); }
		.message.assistant .md-h2 { display: block; font-size: 14px; margin: 6px 0 3px; color: var(--text-primary); }
		.message.assistant .md-h3 { display: block; font-size: 13px; margin: 4px 0 2px; color: var(--text-primary); }
		.message.assistant em { font-style: italic; }
		.message.assistant .md-list {
			margin: 6px 0;
			padding-left: 20px;
			line-height: 1.6;
		}
		.message.assistant .md-list li { margin-bottom: 2px; }
		.message.assistant a {
			color: var(--accent);
			text-decoration: underline;
			text-underline-offset: 2px;
		}
		.message.assistant a:hover { color: var(--accent-hover); }
		/* Generated images */
		.md-image-wrap {
			margin: 8px 0;
			display: inline-block;
			max-width: 100%;
		}
		.md-image {
			max-width: 100%;
			max-height: 400px;
			border-radius: 8px;
			border: 1px solid var(--border-light);
			cursor: pointer;
			transition: transform 0.15s ease;
		}
		.md-image:hover { transform: scale(1.02); }
		.md-image-caption {
			font-size: 11px;
			color: var(--text-faint);
			margin-top: 4px;
			text-align: center;
			font-style: italic;
		}
		/* Audio player */
		.md-audio-wrap {
			margin: 8px 0;
			padding: 10px 14px;
			background: var(--bg-sidebar);
			border-radius: 8px;
			border: 1px solid var(--border-light);
			display: inline-block;
			max-width: 100%;
		}
		.md-audio-label {
			font-size: 12px;
			color: var(--text-secondary);
			margin-bottom: 6px;
		}
		.md-audio {
			width: 100%;
			min-width: 240px;
			height: 36px;
			border-radius: 4px;
		}

		/* System Prompt Modal */
		.sp-modal-overlay {
			position: fixed;
			inset: 0;
			background: rgba(0,0,0,0.6);
			z-index: 1000;
			display: flex;
			align-items: center;
			justify-content: center;
			backdrop-filter: blur(4px);
		}
		.sp-modal {
			background: var(--bg-card);
			border: 1px solid var(--border-light);
			border-radius: 12px;
			width: 92%;
			max-width: 620px;
			max-height: 85vh;
			display: flex;
			flex-direction: column;
			box-shadow: 0 20px 60px rgba(0,0,0,0.4);
		}
		.sp-modal-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding: 16px 20px;
			border-bottom: 1px solid var(--border-light);
		}
		.sp-modal-title {
			font-weight: 600;
			font-size: 15px;
			color: var(--text-primary);
		}
		.sp-modal-close {
			background: none;
			border: none;
			color: var(--text-tertiary);
			font-size: 22px;
			cursor: pointer;
			padding: 0 4px;
			line-height: 1;
		}
		.sp-modal-close:hover { color: var(--text-primary); }
		.sp-modal-body {
			padding: 16px 20px;
			overflow-y: auto;
		}
		.sp-modal-hint {
			font-size: 12px;
			color: var(--text-tertiary);
			margin-bottom: 12px;
			line-height: 1.4;
		}
		.sp-templates {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
			margin-bottom: 12px;
		}
		.sp-tpl-btn {
			display: inline-flex;
			align-items: center;
			gap: 5px;
			padding: 5px 10px;
			border-radius: 20px;
			border: 1px solid var(--border-light);
			background: var(--bg-input);
			color: var(--text-secondary);
			font-size: 12px;
			cursor: pointer;
			transition: all 0.15s ease;
			white-space: nowrap;
		}
		.sp-tpl-btn:hover {
			border-color: var(--accent);
			color: var(--text-primary);
			background: rgba(77,208,187,0.08);
		}
		.sp-tpl-btn.active {
			border-color: var(--accent);
			background: rgba(77,208,187,0.15);
			color: var(--accent);
			font-weight: 500;
		}
		.sp-tpl-label { line-height: 1; }
		.sp-textarea {
			width: 100%;
			background: var(--bg-input);
			color: var(--text-primary);
			border: 1px solid var(--border-light);
			border-radius: 8px;
			padding: 12px;
			font-size: 13px;
			font-family: monospace;
			line-height: 1.5;
			resize: vertical;
			min-height: 120px;
			box-sizing: border-box;
		}
		.sp-textarea:focus {
			outline: none;
			border-color: var(--accent);
		}
		.sp-modal-footer {
			display: flex;
			justify-content: flex-end;
			gap: 8px;
			padding: 12px 20px;
			border-top: 1px solid var(--border-light);
		}
		.action-btn.primary {
			background: var(--accent);
			color: #000;
			border-color: var(--accent);
		}
		.action-btn.primary:hover {
			background: var(--accent-hover);
		}

		.input-hint {
			text-align: center;
			font-size: 11px;
			color: var(--text-faint);
			padding: 2px 0 6px;
		}
		.input-hint kbd {
			display: inline-block;
			font-size: 10px;
			font-family: inherit;
			background: var(--bg-elevated);
			border: 1px solid var(--border-light);
			border-radius: 3px;
			padding: 1px 4px;
			color: var(--text-muted);
		}
		.scroll-bottom-btn {
			position: absolute;
			bottom: 90px;
			right: 24px;
			width: 36px;
			height: 36px;
			border-radius: 50%;
			background: var(--bg-card);
			border: 1px solid var(--border-medium);
			color: var(--text-muted);
			display: flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
			box-shadow: var(--shadow-card);
			opacity: 0;
			transform: translateY(8px);
			pointer-events: none;
			transition: opacity 0.2s, transform 0.2s;
			z-index: 10;
		}
		.scroll-bottom-btn.visible {
			opacity: 1;
			transform: translateY(0);
			pointer-events: auto;
		}
		.scroll-bottom-btn:hover {
			background: var(--bg-elevated);
			color: var(--text-secondary);
			border-color: var(--border-strong);
		}

		.chat-empty-state {
			flex: 1;
			display: flex;
			align-items: center;
			justify-content: center;
			flex-direction: column;
			gap: 8px;
			color: var(--text-faint);
			font-size: 14px;
			padding: 40px;
		}
		.chat-empty-state svg {
			opacity: 0.3;
			margin-bottom: 4px;
		}

		/* ── Dashboard Tab ──────────────────────────────── */
		.dashboard {
			flex: 1;
			overflow-y: auto;
			padding: 24px;
			background: var(--bg-base);
		}
		.dash-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
			gap: 16px;
			margin-bottom: 24px;
		}
		.dash-card {
			background: var(--bg-card);
			border-radius: 12px;
			padding: 20px;
			box-shadow: var(--shadow-card);
			border: 1px solid var(--border-subtle);
		}
		.dash-card h3 {
			font-size: 13px;
			color: var(--text-tertiary);
			text-transform: uppercase;
			letter-spacing: 0.05em;
			margin-bottom: 12px;
			display: flex;
			align-items: center;
			gap: 8px;
			font-weight: 600;
		}
		.dash-card .value {
			font-size: 32px;
			font-weight: 700;
			color: var(--text-primary);
		}
		.dash-card .sub {
			font-size: 12px;
			color: var(--text-muted);
			margin-top: 4px;
		}
		.dash-section {
			background: var(--bg-card);
			border-radius: 12px;
			padding: 20px;
			box-shadow: var(--shadow-card);
			border: 1px solid var(--border-subtle);
			margin-bottom: 16px;
		}
		.dash-section h2 {
			font-size: 16px;
			font-weight: 600;
			color: var(--text-primary);
			margin-bottom: 16px;
			display: flex;
			align-items: center;
			gap: 8px;
		}
		.dash-table-wrap {
			overflow-x: auto;
			-webkit-overflow-scrolling: touch;
			margin: 0 -2px;
			padding: 0 2px;
		}
		.dash-table {
			width: 100%;
			border-collapse: collapse;
			min-width: 480px;
		}
		.dash-table th {
			text-align: left;
			padding: 10px 12px;
			font-size: 12px;
			font-weight: 600;
			color: var(--text-tertiary);
			text-transform: uppercase;
			border-bottom: 1px solid var(--border-light);
		}
		.dash-table td {
			padding: 10px 12px;
			font-size: 13px;
			color: var(--text-secondary);
			border-bottom: 1px solid var(--border-subtle);
		}
		.dash-table tr:hover td {
			background: var(--accent-ghost);
		}
		.badge {
			display: inline-block;
			padding: 4px 8px;
			border-radius: 4px;
			font-size: 11px;
			font-weight: 600;
			max-width: 200px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			vertical-align: middle;
		}
		.badge-green { background: rgba(0,217,111,0.15); color: var(--success); }
		.badge-yellow { background: rgba(255,200,50,0.15); color: var(--warning); }
		.badge-blue { background: var(--accent-subtle); color: var(--accent); }
		.badge-red { background: var(--danger-bg); color: var(--danger); }
		.badge-gray { background: rgba(120,120,120,0.2); color: var(--text-disabled); }
		.badge-purple { background: rgba(168,85,247,0.15); color: #a855f7; }
		.dash-empty {
			text-align: center;
			padding: 40px 20px;
			color: var(--text-muted);
			font-size: 14px;
		}
		.dash-empty-title {
			font-size: 16px;
			color: var(--text-secondary);
			margin-bottom: 8px;
			font-weight: 600;
		}
		.dash-btn {
			padding: 8px 16px;
			border: 1px solid var(--border-medium);
			border-radius: 6px;
			background: var(--bg-input);
			color: var(--text-secondary);
			font-size: 12px;
			cursor: pointer;
			transition: all 0.2s;
		}
		.dash-btn:hover {
			background: var(--bg-elevated);
			border-color: rgba(255,255,255,0.15);
		}
		.dash-btn-primary {
			background: var(--accent);
			color: var(--text-on-accent);
			border: none;
			font-weight: 600;
		}
		.dash-btn-primary:hover:not(:disabled) {
			background: var(--accent-hover);
		}
		.dash-btn:disabled, .dash-btn-primary:disabled {
			opacity: 0.6;
			cursor: not-allowed;
		}
		.dash-btn-success {
			color: var(--success);
			border-color: rgba(0,217,111,0.3);
		}
		.dash-btn-success:hover { background: rgba(0,217,111,0.1); }
		.dash-actions {
			display: flex;
			gap: 8px;
			margin-bottom: 16px;
		}
		.dash-loading {
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 60px;
			color: var(--text-muted);
			gap: 8px;
		}
		.dash-loading::before {
			content: '';
			width: 14px;
			height: 14px;
			border: 2px solid var(--border-strong);
			border-top-color: var(--accent);
			border-radius: 50%;
			animation: spin 0.7s linear infinite;
			flex-shrink: 0;
		}
		/* ── Settings panel styles ── */
		.dash-tabs-bar {
			display: flex;
			gap: 0;
			border-bottom: 1px solid var(--border-light);
			margin-bottom: 20px;
			overflow-x: auto;
			-webkit-overflow-scrolling: touch;
			scrollbar-width: none;
		}
		.dash-tabs-bar::-webkit-scrollbar { display: none; }
		.dash-tab-btn {
			padding: 10px 16px;
			border: none;
			background: transparent;
			color: var(--text-muted);
			font-size: 13px;
			font-weight: 600;
			cursor: pointer;
			border-bottom: 2px solid transparent;
			margin-bottom: -1px;
			transition: all 0.2s;
			white-space: nowrap;
			flex-shrink: 0;
		}
		.dash-tab-btn:hover { color: var(--text-secondary); }
		.dash-tab-btn.active {
			color: var(--accent);
			border-bottom-color: var(--accent);
		}
		.dash-tab-btn-logout {
			margin-left: auto;
			font-size: 11px;
			color: var(--text-muted);
			padding: 6px 12px;
			flex-shrink: 0;
		}
		.dash-tab-btn-logout:hover { color: var(--danger); }
		.dash-tab-panel { display: none; }
		.dash-tab-panel.active { display: block; }
		.section-disabled { opacity: 0.5; pointer-events: none; transition: opacity 0.2s; }
		.section-disabled.section-enabled, .section-enabled { opacity: 1; pointer-events: auto; }
		.settings-group {
			margin-bottom: 20px;
			padding: 16px;
			background: var(--bg-card);
			border-radius: 10px;
			border: 1px solid var(--border-subtle);
		}
		.settings-group h3 {
			font-size: 14px;
			font-weight: 600;
			color: var(--text-primary);
			margin-bottom: 12px;
		}
		.setting-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 10px 0;
			gap: 12px;
			border-bottom: 1px solid var(--border-subtle);
		}
		.setting-row:last-child { border-bottom: none; }
		.setting-label {
			font-size: 13px;
			color: var(--text-secondary);
			flex: 1;
		}
		.setting-label small {
			display: block;
			font-size: 11px;
			color: var(--text-muted);
			margin-top: 2px;
		}
		.setting-toggle {
			position: relative;
			width: 44px;
			height: 24px;
			flex-shrink: 0;
		}
		.setting-toggle input {
			opacity: 0;
			width: 0;
			height: 0;
		}
		.setting-toggle .slider {
			position: absolute;
			cursor: pointer;
			top: 0; left: 0; right: 0; bottom: 0;
			background-color: var(--bg-elevated);
			transition: 0.3s;
			border-radius: 24px;
		}
		.setting-toggle .slider:before {
			position: absolute;
			content: "";
			height: 18px;
			width: 18px;
			left: 3px;
			bottom: 3px;
			background-color: var(--text-disabled);
			transition: 0.3s;
			border-radius: 50%;
		}
		.setting-toggle input:checked + .slider {
			background-color: var(--accent);
		}
		.setting-toggle input:checked + .slider:before {
			transform: translateX(20px);
			background-color: var(--text-on-accent);
		}
		.setting-select {
			padding: 6px 12px;
			border: 1px solid var(--border-medium);
			border-radius: 8px;
			font-size: 12px;
			background: var(--bg-input);
			color: var(--text-secondary);
			cursor: pointer;
			min-width: 100px;
		}
		.setting-textarea {
			width: 100%;
			padding: 10px 12px;
			border: 1px solid var(--border-medium);
			border-radius: 8px;
			font-size: 13px;
			font-family: inherit;
			resize: vertical;
			min-height: 80px;
			max-height: 300px;
			background: var(--bg-input);
			color: var(--text-secondary);
			box-sizing: border-box;
		}
		.setting-textarea:focus, .setting-select:focus {
			outline: none;
			border-color: var(--accent);
			box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 13%, transparent);
		}
		.setting-input {
			padding: 6px 12px;
			border: 1px solid var(--border-medium);
			border-radius: 8px;
			font-size: 13px;
			background: var(--bg-input);
			color: var(--text-secondary);
			width: 80px;
			text-align: center;
		}
		.setting-input-wide {
			width: 100%;
			max-width: 300px;
			text-align: left;
		}
		.setting-input-cmd {
			width: 120px;
			text-align: left;
			font-family: monospace;
			flex-shrink: 0;
		}
		.setting-input-flex {
			flex: 1;
			min-width: 0;
			text-align: left;
		}
		.setting-input:focus {
			outline: none;
			border-color: var(--accent);
			box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 13%, transparent);
		}
		.setting-range {
			width: 120px;
			max-width: 100%;
			accent-color: var(--accent);
			cursor: pointer;
		}
		.chat-select-bar {
			display: flex;
			align-items: center;
			gap: 12px;
			margin-bottom: 16px;
			padding: 12px 16px;
			background: var(--bg-card);
			border-radius: 10px;
			border: 1px solid var(--border-subtle);
		}
		.chat-select-bar label {
			font-size: 13px;
			font-weight: 600;
			color: var(--text-tertiary);
		}
		.dash-toast {
			position: fixed;
			bottom: 24px;
			right: 24px;
			padding: 12px 20px;
			background: var(--bg-elevated);
			color: var(--text-primary);
			font-size: 13px;
			border-radius: 10px;
			box-shadow: 0 4px 16px rgba(0,0,0,0.4);
			border: 1px solid var(--border-light);
			z-index: 9999;
			opacity: 0;
			transform: translateY(8px);
			transition: all 0.3s;
			max-width: 360px;
			line-height: 1.4;
		}
		.dash-toast.show {
			opacity: 1;
			transform: translateY(0);
		}
		.dash-toast.toast-error {
			background: var(--danger);
			color: #fff;
			border-color: var(--danger);
		}
		.dash-toast.toast-success {
			border-color: rgba(0,217,111,0.3);
		}
		.webhook-url-box {
			display: flex;
			gap: 8px;
			align-items: center;
			margin-top: 8px;
			flex-wrap: wrap;
		}
		.webhook-url-box input {
			flex: 1;
			padding: 8px 12px;
			border: 1px solid var(--border-medium);
			border-radius: 8px;
			font-size: 13px;
			font-family: monospace;
			background: var(--bg-input);
			color: var(--text-secondary);
		}
		.webhook-url-box input:focus {
			outline: none;
			border-color: var(--accent);
		}

		/* ── Setup Wizard ──────────────────────────────── */
		.setup-wizard {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			min-height: 300px;
			padding: 40px 20px;
			text-align: center;
		}
		.setup-wizard h2 {
			font-size: 22px;
			font-weight: 700;
			color: var(--text-primary);
			margin-bottom: 8px;
		}
		.setup-wizard p {
			font-size: 14px;
			color: var(--text-tertiary);
			margin-bottom: 24px;
			max-width: 400px;
		}
		.role-cards {
			display: flex;
			flex-wrap: wrap;
			flex-direction: row;
			gap: 12px;
			justify-content: flex-start;
			margin-bottom: 24px;
			max-width: 100%;
		}
		.role-card {
			background: var(--bg-card);
			border: 2px solid var(--border-light);
			border-radius: 12px;
			padding: 16px 20px;
			min-width: 160px;
			cursor: pointer;
			transition: all 0.2s;
			text-align: center;
			user-select: none;
		}
		.role-card:hover {
			border-color: var(--accent);
			box-shadow: 0 2px 12px var(--accent-glow-sm);
		}
		.role-card.selected {
			border-color: var(--accent);
			background: var(--accent-ghost);
			box-shadow: 0 2px 12px var(--accent-glow-sm);
		}
		.role-card .role-title {
			font-size: 14px;
			font-weight: 600;
			color: var(--text-primary);
		}
		.role-card .role-desc {
			font-size: 11px;
			color: var(--text-muted);
			margin-top: 4px;
		}
		.role-card .role-check {
			display: none;
			color: var(--accent);
			font-weight: 700;
			margin-top: 6px;
			font-size: 13px;
		}
		.role-card.selected .role-check {
			display: block;
		}
		/* ── Template Cards ─────────────────────────── */
		.template-cards {
			display: flex;
			flex-direction: column;
			gap: 8px;
		}
		.template-card {
			display: flex;
			align-items: center;
			gap: 12px;
			padding: 12px 16px;
			background: var(--bg-elevated);
			border: 1px solid var(--border-subtle);
			border-radius: 10px;
			cursor: pointer;
			transition: all 0.2s;
		}
		.template-card:hover {
			border-color: var(--accent);
			background: var(--accent-ghost);
		}
		.template-icon {
			width: 36px;
			height: 36px;
			border-radius: 8px;
			background: var(--accent-ghost);
			color: var(--accent);
			display: flex;
			align-items: center;
			justify-content: center;
			font-weight: 700;
			font-size: 14px;
			flex-shrink: 0;
		}
		.template-info { flex: 1; min-width: 0; }
		.template-title {
			font-size: 13px;
			font-weight: 600;
			color: var(--text-primary);
		}
		.template-desc {
			font-size: 11px;
			color: var(--text-muted);
			margin-top: 2px;
		}
		.template-apply {
			font-size: 12px;
			color: var(--accent);
			font-weight: 600;
			padding: 4px 12px;
			border: 1px solid var(--accent);
			border-radius: 6px;
			flex-shrink: 0;
			transition: all 0.2s;
		}
		.template-card:hover .template-apply {
			background: var(--accent);
			color: var(--text-on-accent);
		}
		/* ── Bot Identity Header ────────────────────── */
		.bot-identity-header {
			display: flex;
			align-items: center;
			gap: 12px;
			padding-bottom: 12px;
			border-bottom: 1px solid var(--border-subtle);
		}
		.bot-avatar {
			width: 44px;
			height: 44px;
			border-radius: 50%;
			background: var(--accent);
			color: var(--text-on-accent);
			display: flex;
			align-items: center;
			justify-content: center;
			font-weight: 700;
			font-size: 18px;
			flex-shrink: 0;
		}
		.bot-identity-info { flex: 1; min-width: 0; }
		.bot-identity-name {
			font-size: 16px;
			font-weight: 600;
			color: var(--text-primary);
		}
		.bot-identity-username {
			font-size: 12px;
			color: var(--text-muted);
			font-family: monospace;
		}

		/* ── Kanban Board ──────────────────────────────── */
		.kanban-board {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
			gap: 12px;
			min-height: 200px;
		}
		@media (max-width: 768px) {
			.kanban-board {
				grid-template-columns: 1fr;
			}
		}
		.kanban-col {
			background: var(--bg-inset);
			border-radius: 10px;
			padding: 12px;
			min-height: 120px;
			max-height: 520px;
			display: flex;
			flex-direction: column;
			border: 1px solid var(--border-subtle);
		}
		.kanban-col-cards {
			flex: 1;
			overflow-y: auto;
			min-height: 0;
		}
		.kanban-col-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			margin-bottom: 10px;
			padding-bottom: 8px;
			border-bottom: 1px solid var(--border-light);
		}
		.kanban-col-title {
			font-size: 14px;
			font-weight: 600;
			color: var(--text-secondary);
			text-transform: uppercase;
			letter-spacing: 0.05em;
			display: flex;
			align-items: center;
			gap: 6px;
		}
		.kanban-col-count {
			background: var(--border-light);
			color: var(--text-tertiary);
			font-size: 11px;
			font-weight: 700;
			padding: 2px 8px;
			border-radius: 10px;
		}
		.kanban-card {
			background: var(--bg-card);
			border-radius: 10px;
			padding: 16px;
			margin-bottom: 8px;
			border: 1px solid var(--border-subtle);
			border-left: 3px solid transparent;
			cursor: pointer;
			transition: all 0.2s;
		}
		.kanban-card:last-child { margin-bottom: 0; }
		@media (hover: hover) {
			.kanban-card:hover {
				box-shadow: var(--shadow-elevated);
				transform: translateY(-2px);
			}
		}
		.kanban-card.role-moderator { border-left-color: var(--danger); }
		.kanban-card.role-content { border-left-color: var(--accent); }
		.kanban-card.role-support { border-left-color: var(--purple); }
		.kanban-card-title {
			font-size: 13px;
			font-weight: 600;
			color: var(--text-primary);
			margin-bottom: 4px;
		}
		.kanban-card-desc {
			font-size: 11px;
			color: var(--text-muted);
			margin-bottom: 6px;
			overflow: hidden;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			-webkit-box-orient: vertical;
			line-height: 1.4;
		}
		.kanban-card-meta {
			display: flex;
			align-items: center;
			gap: 6px;
			flex-wrap: wrap;
		}
		.kanban-tag {
			font-size: 10px;
			padding: 2px 6px;
			border-radius: 4px;
			font-weight: 600;
		}
		.kanban-tag-persistent { background: var(--accent-subtle); color: var(--accent); }
		.kanban-tag-recurring { background: rgba(255,200,50,0.15); color: var(--warning); }
		.kanban-tag-oneshot { background: rgba(120,120,120,0.2); color: var(--text-disabled); }
		.kanban-stat {
			font-size: 10px;
			color: var(--text-muted);
			display: flex;
			align-items: center;
			gap: 2px;
		}
		.kanban-empty {
			text-align: center;
			padding: 24px 12px;
			color: var(--text-faint);
			font-size: 12px;
		}

		/* ── Task Detail Modal ─────────────────────────── */
		.task-modal-overlay {
			position: fixed;
			top: 0; left: 0; right: 0; bottom: 0;
			background: rgba(0,0,0,0);
			backdrop-filter: blur(0px);
			-webkit-backdrop-filter: blur(0px);
			display: flex;
			align-items: center;
			justify-content: center;
			z-index: 999;
			padding: 20px;
			pointer-events: none;
			visibility: hidden;
			transition: background 0.25s, backdrop-filter 0.25s, -webkit-backdrop-filter 0.25s, visibility 0s 0.25s;
		}
		.task-modal-overlay.open {
			background: rgba(0,0,0,0.55);
			backdrop-filter: blur(4px);
			-webkit-backdrop-filter: blur(4px);
			pointer-events: auto;
			visibility: visible;
			transition: background 0.25s, backdrop-filter 0.25s, -webkit-backdrop-filter 0.25s, visibility 0s 0s;
		}
		.task-modal {
			background: var(--bg-card);
			border-radius: 14px;
			width: 100%;
			max-width: 600px;
			max-height: 85vh;
			overflow-y: auto;
			padding: 24px;
			box-shadow: var(--shadow-modal);
			border: 1px solid var(--border-light);
			opacity: 0;
			transform: translateY(12px) scale(0.97);
			transition: opacity 0.25s, transform 0.25s;
		}
		.task-modal-overlay.open .task-modal {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
		.task-modal h3 {
			font-size: 18px;
			font-weight: 700;
			color: var(--text-primary);
			margin-bottom: 4px;
		}
		.task-modal .task-desc {
			font-size: 13px;
			color: var(--text-tertiary);
			margin-bottom: 16px;
		}
		.task-stats-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
			gap: 8px;
			margin-bottom: 16px;
		}
		.task-stat-card {
			background: var(--bg-input);
			border-radius: 8px;
			padding: 10px;
			text-align: center;
			border: 1px solid var(--border-subtle);
		}
		.task-stat-card .stat-val {
			font-size: 22px;
			font-weight: 700;
			color: var(--text-primary);
		}
		.task-stat-card .stat-label {
			font-size: 10px;
			color: var(--text-muted);
			text-transform: uppercase;
			letter-spacing: 0.05em;
		}
		.task-logs {
			max-height: 280px;
			overflow-y: auto;
			font-size: 12px;
			background: var(--bg-sidebar);
			color: var(--text-secondary);
			border-radius: 8px;
			padding: 10px 12px;
			font-family: monospace;
			line-height: 1.6;
			border: 1px solid var(--border-subtle);
		}
		.modal-close-btn {
			background: none;
			border: 1px solid var(--border-medium);
			border-radius: 8px;
			color: var(--text-tertiary);
			font-size: 18px;
			width: 32px;
			height: 32px;
			display: flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
			transition: all 0.15s;
			flex-shrink: 0;
			line-height: 1;
		}
		.modal-close-btn:hover {
			background: var(--bg-elevated);
			color: var(--text-primary);
			border-color: var(--border-strong);
		}
		.task-log-entry {
			padding: 2px 0;
			border-bottom: 1px solid var(--border-subtle);
		}
		.task-log-time {
			color: var(--text-muted);
			margin-right: 8px;
		}
		.task-modal-actions {
			display: flex;
			gap: 8px;
			margin-top: 16px;
			justify-content: flex-end;
		}

		/* ── Create Post Form ──────────────────────────── */
		.post-targets {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			margin-top: 8px;
		}
		.post-target-label {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 6px 12px;
			background: var(--bg-input);
			border: 1px solid var(--border-subtle);
			border-radius: 8px;
			font-size: 13px;
			cursor: pointer;
			transition: border-color 0.15s, background 0.15s;
		}
		.post-target-label:hover {
			border-color: var(--accent);
			background: var(--accent-faint);
		}
		.post-target-label.disabled {
			opacity: 0.4;
			cursor: not-allowed;
		}
		.post-target-label input[type="checkbox"] {
			accent-color: var(--accent);
			width: 16px;
			height: 16px;
		}
		.schedule-options {
			display: flex;
			flex-wrap: wrap;
			gap: 12px;
			margin-top: 8px;
		}
		.schedule-option {
			display: flex;
			align-items: center;
			gap: 6px;
			font-size: 13px;
			cursor: pointer;
		}
		.schedule-option input[type="radio"],
		.schedule-option input[type="checkbox"] {
			accent-color: var(--accent);
			width: 16px;
			height: 16px;
		}
		.cron-preview {
			font-size: 11px;
			color: var(--accent);
			padding: 6px 10px;
			background: var(--accent-faint);
			border-radius: 6px;
			margin-top: 8px;
		}

		/* ── Accessibility ─────────────────────────────── */
		@media (prefers-reduced-motion: reduce) {
			*, *::before, *::after {
				animation-duration: 0.01ms !important;
				animation-iteration-count: 1 !important;
				transition-duration: 0.01ms !important;
				scroll-behavior: auto !important;
			}
			.kanban-card:hover { transform: none; }
			.dash-toast { transition: none; }
		}

		/* ── Responsive ────────────────────────────────── */
		@media (max-width: 1024px) {
			.dashboard { padding: 16px; }
			.dash-grid { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
			.kanban-board { gap: 10px; }
			.kanban-col { max-height: 420px; }
		}
		@media (max-width: 768px) {
			.dashboard { padding: 14px; }
			.dash-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }
			.grid-2col { grid-template-columns: 1fr; }
			.chat-select-bar { flex-wrap: wrap; }
			.task-modal-actions { flex-wrap: wrap; }
			.task-modal-actions .dash-btn { flex: 1; min-width: 0; text-align: center; }
		}
		@media (max-width: 640px) {
			body { padding: 0; }
			.container {
				height: 100vh;
				height: 100dvh;
				max-width: 100%;
				border-radius: 0;
				border: none;
			}
			.header { padding: 12px 14px; }
			.header h1 { font-size: 16px; }
			.tab-btn { padding: 8px 12px; font-size: 12px; }
			.messages { padding: 12px; }
			.input-area { padding: 12px; gap: 8px; }
			.input-area textarea { padding: 10px 14px; font-size: 13px; }
			.input-area button { padding: 10px 16px; font-size: 13px; }
			.dashboard { padding: 12px; }
			.dash-grid { grid-template-columns: 1fr; gap: 10px; }
			.dash-card { padding: 14px; }
			.dash-card .value { font-size: 26px; }
			.settings-group { padding: 12px; }
			.task-modal { width: 95%; padding: 16px; max-height: 90vh; }
			.role-cards {
				max-width: 100%;
				flex-direction: column;
			}
			.role-card { min-width: 130px; padding: 12px 14px; }
			.template-card { padding: 10px 12px; }
			.template-apply { display: none; }
			.bot-identity-header { flex-wrap: wrap; }
			.kanban-col { max-height: none; }
			.task-modal-actions { flex-direction: column; }
			.task-modal-actions .dash-btn { width: 100%; }
		}
	`;
}
