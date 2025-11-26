"use client";

import React from "react";
import { useState, useEffect } from "react";
import { Wifi, WifiOff, Plus, Circle } from "lucide-react";
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
  const currentAgent = selectedAgent || contextSelectedAgent;

  // Refresh agent health on mount
  useEffect(() => {
    refreshAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array to run only on mount

  // Find health status for selected agent
  const selectedAgentHealth = currentAgent?.health;
  const isConnected = selectedAgentHealth?.isOnline ?? false;

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
      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
        <div className="flex items-center gap-1">
          {isConnected ? (
            <Wifi className="h-4 w-4 text-green-400" />
          ) : (
            <WifiOff className="h-4 w-4 text-red-400" />
          )}
          <span className="hidden sm:inline">
            {isConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      <Select value={currentAgent?.id} onValueChange={handleValueChange}>
        <SelectTrigger className="w-[240px] bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white shadow-sm">
          <SelectValue placeholder="Select an agent" />
        </SelectTrigger>
        <SelectContent className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
          {agents.map((agent) => (
            <SelectItem
              key={agent.id}
              value={agent.id}
              className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 focus:bg-gray-100 dark:focus:bg-gray-700"
              disabled={!agent.health?.isOnline}
            >
              <div className="flex items-center gap-2">
                <div className="flex items-center">
                  <Circle
                    className={`h-2 w-2 ${
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
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-white">
                      {agent.name}
                    </span>
                    {!agent.health?.isOnline && (
                      <Badge
                        variant="destructive"
                        className="text-xs py-0 px-1 h-4"
                      >
                        Offline
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[180px]">
                    {agent.url.replace(/^https?:\/\//, "")}
                  </span>
                  {agent.health && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {getAgentStatusMessage(agent)}
                    </span>
                  )}
                </div>
              </div>
            </SelectItem>
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
