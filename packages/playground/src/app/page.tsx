import { AnimatedBackground } from "@/components/animated-background";
import { FloatingChatButton } from "@/components/floating-chat";

export default function Home() {
  return (
    <>
      {/* Animated Background */}
      <AnimatedBackground />

      {/* Main Content */}
      <div className="relative z-10 min-h-screen flex items-center justify-center">
        <div className="text-center text-white">
          <h1 className="text-4xl sm:text-6xl font-bold mb-6 bg-clip-text text-transparent bg-gradient-to-r from-white via-white/90 to-white/70">
            AI Agent Playground
          </h1>
          <p className="text-lg sm:text-xl mb-8 text-white/80 max-w-2xl mx-auto px-4">
            Connect and chat with your AI agents in a beautiful, responsive
            interface.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 items-center justify-center px-4">
            <FloatingChatButton />
          </div>
        </div>
      </div>
    </>
  );
}
