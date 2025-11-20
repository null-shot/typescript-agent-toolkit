# Email MCP (Durable Object SQL DB + Cloudflare Email)

An MCP server that:

- Sends internal emails via Cloudflare's Email binding (only to verified addresses).
- Manages email data via Durable Object SQLite storage.
- Exposes MCP tools and resources to interact with emails.

Features

- Tools:
  - create_test_email(from_addr, to_addr, subject, text) - Create test emails for database testing
  - send_email(to, subject, text) - Send real emails via Cloudflare Email Workers (requires domain setup)
  - list_emails(search_text?, limit?, offset?, sort_by?, sort_direction?) - List stored emails with rich previews
  - get_email(id) - Get detailed email by ID
- Resources:
  - do://database/emails - List emails with filtering
  - do://database/emails/{id} - Get specific email

Important limitations

- This is for internal email only. Cloudflare’s Send Email binding delivers only to verified recipients on your zone.
- Not a general outbound SMTP service.

Setup

1. Durable Object SQL Database

- No external database setup required! The Durable Object has built-in SQLite storage.
- Email data is stored in the Durable Object's persistent SQLite database.

2. Email Routing and bindings

- Verify MAIL_FROM (sender) address in Cloudflare Email Routing.
- Verify intended recipient addresses or domains (ALLOWED_RECIPIENTS).
- Add “Send Email” binding named SEND_EMAIL in wrangler.jsonc.

3. Durable Object binding

- EMAIL_MCP_SERVER is defined in wrangler.jsonc. No extra setup beyond deploy.

4. Env vars

- MAIL_FROM: the verified sender (e.g., no-reply@example.com)
- ALLOWED_RECIPIENTS: comma-separated emails or @domain rules. Examples:
  - "alice@example.com,bob@example.com,@example.com"

Local development

- Install deps: pnpm i
- Update wrangler.jsonc vars and bindings.
- Run: pnpm dev

Deploy

- pnpm deploy

Testing MCP with the Playground

- Start the Playground package or your client.
- Connect via HTTP/SSE to this Worker’s /mcp (the MCP package already mounts standard endpoints in the DO).
- Call tools:
  - send_email
  - list_emails
  - get_email

Testing the MCP Server

## Database Testing (No Domain Setup Required)

You can test the core email management functionality immediately:

1. **Connect to MCP server**:
   - Local: http://localhost:PORT/mcp (where PORT is shown by wrangler dev)
   - Production: https://your-worker.workers.dev/mcp

2. **Create test emails**:
   - Tool: `create_test_email`
   - Purpose: Populate the database with test data for demonstration
   - Example: `{"from_addr": "alice@company.com", "to_addr": "bob@company.com", "subject": "Test Email", "text": "Hello world!"}`
   - Result: Creates email in Durable Object SQLite database with verification

3. **List emails**:
   - Tool: `list_emails`
   - Shows: Full email details with IDs, subjects, sender→recipient, content previews
   - Copy any full UUID for detailed viewing

4. **Get specific email**:
   - Tool: `get_email`
   - Use: Any UUID from the list_emails results
   - Shows: Complete email details including full content

## Email Sending Testing (Requires Domain Setup)

To test the `send_email` tool for actual email delivery:

### Prerequisites:

1. **Own a domain** registered with any provider
2. **Add domain to Cloudflare** and enable Email Routing
3. **Verify sender addresses** in Cloudflare Email Routing → Send tab
4. **Update MAIL_FROM** in wrangler.jsonc to your verified domain
5. **Update ALLOWED_RECIPIENTS** with addresses you want to allow

### Setup Steps:

1. **Cloudflare Dashboard** → Your Domain → Email → Email Routing
2. **Enable Email Routing** (adds required DNS records automatically)
3. **Add destination addresses** and verify them via email
4. **Go to Send tab** → Add and verify sender addresses (e.g., no-reply@yourdomain.com)
5. **Update wrangler.jsonc**:
   ```json
   "vars": {
     "MAIL_FROM": "no-reply@yourdomain.com",
     "ALLOWED_RECIPIENTS": "your-email@anywhere.com,@yourdomain.com"
   }
   ```
6. **Deploy**: `wrangler deploy`
7. **Test**: Use `send_email` tool with allowed recipients

### Expected Results:

- **✅ Allowed recipients**: Email sent successfully
- **❌ Disallowed recipients**: "Recipient not allowed" error
- **❌ Unverified sender domain**: "domain not owned" error

Notes

- Large raw messages: we store only the text and metadata in the Durable Object SQLite database. If you need full raw message storage, consider R2.
- If you see recipient not allowed, update ALLOWED_RECIPIENTS.
- The Durable Object SQLite database provides strong consistency and is automatically managed by Cloudflare.

