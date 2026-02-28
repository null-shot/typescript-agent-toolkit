import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		tailwindcss(), // Required for Tailwind v4
		react(),
		cloudflare(), // Cloudflare Workers integration
	],
	server: {
		port: 8000,
		host: true,
	},
});
