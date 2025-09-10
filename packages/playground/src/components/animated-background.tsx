"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

export function AnimatedBackground() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600" />
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden">
      {/* Main animated gradient background */}
      <div className="absolute inset-0 animated-gradient" />

      {/* Floating orbs */}
      <div className="absolute inset-0">
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute rounded-full opacity-20 mix-blend-multiply filter blur-xl"
            style={{
              background:
                i % 2 === 0
                  ? "var(--gradient-tertiary)"
                  : "var(--gradient-quaternary)",
              width: `${Math.random() * 300 + 100}px`,
              height: `${Math.random() * 300 + 100}px`,
            }}
            initial={{
              x: Math.random() * window.innerWidth,
              y: Math.random() * window.innerHeight,
            }}
            animate={{
              x: Math.random() * window.innerWidth,
              y: Math.random() * window.innerHeight,
            }}
            transition={{
              duration: Math.random() * 20 + 20,
              repeat: Infinity,
              repeatType: "reverse",
              ease: "linear",
            }}
          />
        ))}
      </div>

      {/* Grid overlay for depth */}
      <div className="absolute inset-0 opacity-10">
        <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern
              id="grid"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                stroke="white"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      {/* Radial overlay for focus */}
      <div
        className="absolute inset-0 bg-radial-gradient"
        style={{
          background:
            "radial-gradient(circle at center, transparent 40%, rgba(0,0,0,0.1) 100%)",
        }}
      />
    </div>
  );
}

export function BackgroundOrbs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Large background orbs */}
      {[...Array(3)].map((_, i) => (
        <motion.div
          key={`large-${i}`}
          className="absolute rounded-full opacity-30 mix-blend-multiply filter blur-3xl"
          style={{
            background: [
              "var(--gradient-primary)",
              "var(--gradient-secondary)",
              "var(--gradient-tertiary)",
            ][i],
            width: "800px",
            height: "800px",
          }}
          initial={{
            x: -200,
            y: -200,
          }}
          animate={{
            x: ["-200px", "100vw", "-200px"],
            y: ["-200px", "100vh", "-200px"],
            scale: [1, 1.2, 1],
          }}
          transition={{
            duration: 30 + i * 10,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      ))}

      {/* Medium floating orbs */}
      {[...Array(4)].map((_, i) => (
        <motion.div
          key={`medium-${i}`}
          className="absolute rounded-full opacity-20 mix-blend-screen filter blur-2xl"
          style={{
            background:
              i % 2 === 0
                ? "var(--gradient-quaternary)"
                : "var(--gradient-secondary)",
            width: "300px",
            height: "300px",
          }}
          animate={{
            x: ["0vw", "100vw", "0vw"],
            y: ["0vh", "100vh", "0vh"],
            scale: [0.8, 1.3, 0.8],
          }}
          transition={{
            duration: 25 + i * 5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

