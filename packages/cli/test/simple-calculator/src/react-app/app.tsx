/**
 * App Component
 *
 * Main application component with React Router and React Query.
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Calculator from '../components/Calculator';
import './globals.css';

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 1000 * 60 * 5, // 5 minutes
			refetchOnWindowFocus: false,
		},
	},
});

function HomePage() {
	return (
		<div className="relative flex items-center justify-center min-h-screen overflow-hidden p-6">
			{/* Ambient blobs */}
			<div
				style={{ background: 'radial-gradient(circle at 30% 40%, rgba(34,211,238,0.18) 0%, transparent 60%)' }}
				className="pointer-events-none absolute inset-0"
			/>
			<div
				style={{ background: 'radial-gradient(circle at 75% 65%, rgba(20,184,166,0.14) 0%, transparent 55%)' }}
				className="pointer-events-none absolute inset-0"
			/>

			<div className="relative w-full max-w-sm">
				<p className="text-center text-xs font-semibold tracking-[0.2em] uppercase mb-6" style={{ color: 'rgba(34,211,238,0.6)' }}>
					Calculator
				</p>
				<Calculator />
			</div>
		</div>
	);
}

export default function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<BrowserRouter>
				<div className="min-h-screen text-white" style={{ background: 'hsl(235 25% 7%)' }}>
					<Routes>
						<Route path="/" element={<HomePage />} />
					</Routes>
				</div>
			</BrowserRouter>
		</QueryClientProvider>
	);
}
