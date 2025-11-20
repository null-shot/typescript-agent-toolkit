import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function setupServerTools(server: McpServer, env: Env) {
	// Get current time tool
	server.tool(
		'is_prime',
		'Returns true if the number is prime, false otherwise',
		{
			num: z.number().int().describe('The number to check if it is prime'),
		},
		async ({ num }: { num: number }) => {
			let storedPrime = await env.EXAMPLE_KV.get(num.toString());
			let numIsPrime;
			if (!storedPrime) {
				numIsPrime = isPrime(num);
				await env.EXAMPLE_KV.put(num.toString(), numIsPrime.toString());
			} else {
				numIsPrime = storedPrime === 'true';
			}
			return {
				content: [
					{
						type: 'text',
						text: `Number: ${num} is prime: ${numIsPrime}`,
					},
				],
				isPrime: numIsPrime,
			};
		},
	);
}

function isPrime(num: number): boolean {
	if (num <= 1) return false;
	for (let i = 2; i * i <= num; i++) {
		if (num % i === 0) return false;
	}
	return true;
}
