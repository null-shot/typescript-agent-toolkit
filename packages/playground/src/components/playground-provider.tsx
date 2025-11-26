"use client";

import React, { ReactNode } from "react";
import { AgentProvider, AgentProviderProps } from "@/lib/agent-context";
import { Toaster } from "@/components/ui/toaster";

export interface PlaygroundProviderProps extends Omit<AgentProviderProps, "children"> {
  children: ReactNode;
  showToaster?: boolean;
}

export function PlaygroundProvider({ 
  children, 
  showToaster = true,
  ...agentProviderProps 
}: PlaygroundProviderProps) {
  return (
    <AgentProvider {...agentProviderProps}>
      {children}
      {showToaster && <Toaster />}
    </AgentProvider>
  );
}