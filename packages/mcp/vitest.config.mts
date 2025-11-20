import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				isolatedStorage: false, // Must have for Durable Objects
				singleWorker: true,
				wrangler: { configPath: './test/wrangler.test.jsonc' },
			},
		},
		// Include test files in both src and test directories
		include: ['test/**/*.test.ts'],
		deps: {
			optimizer: {
				ssr: {
					include: ['ajv', 'raw-body', 'http-errors', 'statuses'],
				},
			},
		},
	},
	resolve: {
		alias: {
			ajv: '@nullshot/test-utils/vitest/ajv-mock',
			'ajv/dist/ajv': '@nullshot/test-utils/vitest/ajv-mock',
		},
	},
	define: {
		global: 'globalThis',
	},
});
