
import { renderToString } from 'react-dom/server';
import { createElement, StrictMode } from 'react';
import { StaticRouter } from 'react-router';
import { Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 1000 * 60 * 5,
			refetchOnWindowFocus: false,
		},
	},
});

function HomePage() {
	return createElement(
		'div',
		{ className: 'flex items-center justify-center p-4 min-h-screen' },
		createElement(
			'div',
			{ className: 'text-center' },
			createElement(
				'h1',
				{ className: 'text-6xl font-bold bg-gradient-to-r from-purple-400 to-pink-600 bg-clip-text text-transparent' },
				'Nullshot Beta'
			)
		)
	);
}

function AppContent() {
	return createElement(
		'div',
		{ className: 'min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 text-white' },
		createElement(
			Routes,
			null,
			createElement(Route, { path: '/', element: createElement(HomePage) })
		)
	);
}

export async function renderApp(pathname: string): Promise<string> {
	const appHtml = renderToString(
		createElement(
			StrictMode,
			null,
			createElement(
				QueryClientProvider,
				{ client: queryClient },
				createElement(
					StaticRouter,
					{ location: pathname },
					createElement(AppContent)
				)
			)
		)
	);

	return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="NullShot App - Built with React and Cloudflare Workers" />
    <title>NullShot App</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <style>
      /* Critical CSS - inlined for fast first paint */
      :root {
        color-scheme: dark;
        --background: hsl(240 10% 4%);
        --foreground: hsl(200 10% 95%);
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        background-color: var(--background);
        color: var(--foreground);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        min-height: 100vh;
      }
      /* Loading state before hydration */
      .ssr-loading { opacity: 0.8; }
    </style>
    <!-- Preload the main bundle for faster hydration -->
    <link rel="modulepreload" href="/assets/main.js" />
  </head>
  <body>
    <div id="root" class="ssr-loading">${appHtml}</div>
    <script type="module">
      document.getElementById('root').classList.remove('ssr-loading');
    </script>
    <script type="module" src="/assets/main.js"></script>
  </body>
</html>`;
}

export async function renderAppToString(pathname: string = '/'): Promise<string> {
	return renderToString(
		createElement(
			StrictMode,
			null,
			createElement(
				QueryClientProvider,
				{ client: queryClient },
				createElement(
					StaticRouter,
					{ location: pathname },
					createElement(AppContent)
				)
			)
		)
	);
}
