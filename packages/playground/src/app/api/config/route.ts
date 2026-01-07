import { NextResponse } from "next/server"

export async function GET() {
	// Read environment variables at runtime (server-side)
	const agentName = process.env.NEXT_PUBLIC_DEFAULT_AGENT_NAME || "Default Agent"
	const agentUrl = process.env.NEXT_PUBLIC_DEFAULT_AGENT_URL || "http://localhost:8787"

	console.log("[API Config] Reading env vars:", {
		NEXT_PUBLIC_DEFAULT_AGENT_NAME: process.env.NEXT_PUBLIC_DEFAULT_AGENT_NAME,
		NEXT_PUBLIC_DEFAULT_AGENT_URL: process.env.NEXT_PUBLIC_DEFAULT_AGENT_URL,
		result: { defaultAgentName: agentName, defaultAgentUrl: agentUrl }
	})

	return NextResponse.json({
		defaultAgentName: agentName,
		defaultAgentUrl: agentUrl,
	})
}

