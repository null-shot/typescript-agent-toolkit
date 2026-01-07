"use client";

import React from "react";
import { useState, useEffect } from "react";
import { Wifi, WifiOff, Plus, Circle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { type Agent } from "@/lib/config";
import { AddAgentModal } from "./add-agent-modal";
import { useAgentSelection, useAgentManagement } from "@/lib/agent-context";
import { getAgentStatusMessage } from "@/lib/agent-health";
import * as SelectPrimitive from "@radix-ui/react-select";

export interface AgentSelectorProps {
  selectedAgent: Agent;
  onAgentChange: (agent: Agent) => void;
  className?: string;
}

export function AgentSelector({
  selectedAgent,
  onAgentChange,
  className,
}: AgentSelectorProps) {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Use the agent context hooks
  const {
    agents,
    selectedAgent: contextSelectedAgent,
    selectAgent,
  } = useAgentSelection();
  const { refreshAgents } = useAgentManagement();

  // Use the selected agent from props or context (props takes precedence)
  // Props agent has priority because it's updated with latest health from FloatingChat
  const currentAgent = selectedAgent || contextSelectedAgent;
  
  // Debug: log current agent name
  React.useEffect(() => {
    if (currentAgent) {
      console.log("[AgentSelector] Current agent:", currentAgent.name, "ID:", currentAgent.id);
    }
  }, [currentAgent]);

  // Refresh agent health on mount
  useEffect(() => {
    refreshAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array to run only on mount

  // Find health status for selected agent
  // Use health from props agent if available (it's more up-to-date), otherwise use context agent
  const selectedAgentHealth = selectedAgent?.health || currentAgent?.health;
  // Only show disconnected if health has been checked and agent is offline
  // Don't show disconnected if health check hasn't been performed yet
  const isConnected = selectedAgentHealth?.isOnline ?? false;
  const healthChecked = selectedAgentHealth !== undefined;
  const showDisconnected = healthChecked && !isConnected;

  const handleValueChange = (value: string) => {
    if (value === "__add_agent__") {
      setIsAddModalOpen(true);
      return;
    }

    const agent = agents.find((agent) => agent.id === value);
    if (agent) {
      // Update both the context and call the prop callback
      selectAgent(agent.id);
      onAgentChange(agent);
    }
  };

  const handleAgentAdded = (newAgent: Agent) => {
    // The context will automatically handle the new agent
    // Just close the modal and the new agent will appear in the list
    setIsAddModalOpen(false);
    // Automatically select the new agent if it's online
    if (newAgent.health?.isOnline) {
      selectAgent(newAgent.id);
      onAgentChange(newAgent);
    }
  };

  return (
    <div className={cn("flex items-center gap-3", className)}>
      {/* Only show disconnected status if health has been checked and agent is offline */}
      {showDisconnected && (
        <div className="flex items-center gap-2 text-sm text-red-500 dark:text-red-400">
          <div className="flex items-center gap-1">
            <WifiOff className="h-4 w-4" />
            <span className="hidden sm:inline">Disconnected</span>
          </div>
        </div>
      )}

      <Select value={currentAgent?.id} onValueChange={handleValueChange}>
        <SelectTrigger className="w-[200px] bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white shadow-sm">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {currentAgent && currentAgent.health?.isOnline && (
              <Circle
                className="h-2 w-2 text-green-400 shrink-0"
                fill="currentColor"
              />
            )}
            <SelectValue placeholder="Select an agent" className="truncate" />
          </div>
        </SelectTrigger>
        <SelectContent className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
          {agents.map((agent) => (
            <SelectPrimitive.Item
              key={agent.id}
              value={agent.id}
              disabled={!agent.health?.isOnline}
              className={cn(
                "cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 focus:bg-gray-100 dark:focus:bg-gray-700 py-3 relative flex w-full items-center gap-2 rounded-sm pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                !agent.health?.isOnline && "opacity-50"
              )}
            >
              <span className="absolute right-2 flex size-3.5 items-center justify-center">
                <SelectPrimitive.ItemIndicator>
                  <Check className="size-4" />
                </SelectPrimitive.ItemIndicator>
              </span>
              {/* Text for SelectValue - must be visible for SelectValue to read it */}
              <SelectPrimitive.ItemText>
                {agent.name}
              </SelectPrimitive.ItemText>
              {/* Visible content in dropdown */}
              <div className="flex items-start gap-3 w-full">
                <div className="flex items-center pt-1">
                  <Circle
                    className={`h-2.5 w-2.5 ${
                      agent.health?.isOnline
                        ? agent.health.responseTime &&
                          agent.health.responseTime > 2000
                          ? "text-yellow-400"
                          : "text-green-400"
                        : "text-red-400"
                    }`}
                    fill="currentColor"
                  />
                </div>
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-gray-900 dark:text-white">
                      {agent.name}
                    </span>
                    {!agent.health?.isOnline && (
                      <Badge
                        variant="destructive"
                        className="text-xs py-0 px-1.5 h-5"
                      >
                        Offline
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-gray-600 dark:text-gray-400 truncate">
                    {agent.url.replace(/^https?:\/\//, "")}
                  </span>
                  {agent.health && (
                    <span className="text-xs text-gray-500 dark:text-gray-500">
                      {getAgentStatusMessage(agent)}
                    </span>
                  )}
                </div>
              </div>
            </SelectPrimitive.Item>
          ))}

          {/* Add Agent Option */}
          <SelectItem
            value="__add_agent__"
            className="cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 focus:bg-blue-50 dark:focus:bg-blue-900/20 border-t border-gray-200 dark:border-gray-600 mt-1"
          >
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
              <Plus className="h-4 w-4" />
              <span className="font-medium">Add Agent</span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>

      <AddAgentModal
        open={isAddModalOpen}
        onOpenChange={setIsAddModalOpen}
        onAgentAdded={handleAgentAdded}
      />
    </div>
  );
}
