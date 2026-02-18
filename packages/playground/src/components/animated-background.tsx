"use client";

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const ORB_COUNT = 6;

interface OrbConfig {
  background: string;
  size: number;
  initialX: number;
  initialY: number;
  targetX: number;
  targetY: number;
  duration: number;
}

export function AnimatedBackground() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Memoize orb configurations so random values are stable across re-renders
  const orbConfigs = useMemo<OrbConfig[]>(() => {
    const width = typeof window !== "undefined" ? window.innerWidth : 1024;
    const height = typeof window !== "undefined" ? window.innerHeight : 768;

    return Array.from({ length: ORB_COUNT }, (_, i) => ({
      background:
        i % 3 === 0
          ? "var(--gradient-tertiary)"
          : i % 3 === 1
            ? "var(--gradient-quaternary)"
            : "radial-gradient(circle, rgba(0,212,170,0.3), transparent)",
      size: Math.random() * 300 + 100,
      initialX: Math.random() * width,
      initialY: Math.random() * height,
      targetX: Math.random() * width,
      targetY: Math.random() * height,
      duration: Math.random() * 20 + 20,
    }));
  }, []);

  if (!mounted) {
    return (
      <div className="fixed inset-0 bg-[#0f0f0f]" />
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden">
      {/* Main animated gradient background */}
      <div className="absolute inset-0 animated-gradient" />

      {/* Floating orbs */}
      <div className="absolute inset-0">
        {orbConfigs.map((orb, i) => (
          <motion.div
            key={i}
            className="absolute rounded-full opacity-10 mix-blend-screen filter blur-xl"
            style={{
              background: orb.background,
              width: `${orb.size}px`,
              height: `${orb.size}px`,
            }}
            initial={{
              x: orb.initialX,
              y: orb.initialY,
            }}
            animate={{
              x: orb.targetX,
              y: orb.targetY,
            }}
            transition={{
              duration: orb.duration,
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


