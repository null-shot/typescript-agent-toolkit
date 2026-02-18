"use client";

import React from "react";
import { useState } from "react";
import { Plus, Loader2, Check, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogOverlay,
  DialogPortal,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  validateAgentUrl,
  testAgentConnection,
} from "@/lib/agent-storage";
import { useAgentManagement } from "@/lib/agent-context";

export interface AddAgentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAgentAdded: () => void;
}

export function AddAgentModal({
  open,
  onOpenChange,
  onAgentAdded,
}: AddAgentModalProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<{
    tested: boolean;
    online: boolean;
    error?: string;
  }>({ tested: false, online: false });
  const [error, setError] = useState<string | null>(null);

  // Use the agent management context
  const { addAgent, isLoading } = useAgentManagement();

  const resetForm = () => {
    setName("");
    setUrl("");
    setError(null);
    setConnectionStatus({ tested: false, online: false });
    setIsTestingConnection(false);
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const testConnection = async () => {
    const validation = validateAgentUrl(url);
    if (!validation.isValid) {
      setError(validation.error || "Invalid URL");
      return;
    }

    setIsTestingConnection(true);
    setError(null);

    try {
      const result = await testAgentConnection(url);
      setConnectionStatus({
        tested: true,
        online: result.isOnline,
        error: result.error,
      });

      if (!result.isOnline) {
        setError(`Connection failed: ${result.error}`);
      }
    } catch {
      setError("Failed to test connection");
      setConnectionStatus({ tested: true, online: false });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !url.trim()) {
      setError("Both name and URL are required");
      return;
    }

    // Validate URL
    const validation = validateAgentUrl(url);
    if (!validation.isValid) {
      setError(validation.error || "Invalid URL");
      return;
    }

    setError(null);

    try {
      const result = await addAgent(name.trim(), url.trim());
      if (result.success) {
        onAgentAdded();
        handleClose();
      } else {
        setError(result.error || "Failed to add agent");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save agent");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogPortal>
        {/* Custom solid overlay */}
        <DialogOverlay className="bg-black/90 backdrop-blur-sm" />
        <DialogContent
          className="sm:max-w-md bg-[#1e1e1e] border border-[rgba(255,255,255,0.08)] shadow-2xl text-white"
          showCloseButton={true}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Plus className="h-5 w-5" />
              Add New Agent
            </DialogTitle>
            <DialogDescription className="text-[#a0a0a0]">
              Add a custom agent by providing a name and URL. The URL should
              point to a running agent instance.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label
                htmlFor="agent-name"
                className="text-white font-medium"
              >
                Agent Name
              </Label>
              <Input
                id="agent-name"
                placeholder="My Custom Agent"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#252525] border-[rgba(255,255,255,0.1)] text-white placeholder:text-[#666666]"
              />
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="agent-url"
                className="text-white font-medium"
              >
                Agent URL
              </Label>
              <div className="flex gap-2">
                <Input
                  id="agent-url"
                  placeholder="https://my-agent.example.com"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setConnectionStatus({ tested: false, online: false });
                    setError(null);
                  }}
                  className="flex-1 bg-[#252525] border-[rgba(255,255,255,0.1)] text-white placeholder:text-[#666666]"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={testConnection}
                  disabled={!url.trim() || isTestingConnection}
                  className="shrink-0 bg-[#252525] border-[rgba(255,255,255,0.1)] text-[#d0d0d0] hover:bg-[#303030]"
                >
                  {isTestingConnection ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Test"
                  )}
                </Button>
              </div>

              {/* Connection Status */}
              {connectionStatus.tested && (
                <div className="flex items-center gap-2 text-sm">
                  {connectionStatus.online ? (
                    <>
                      <Check className="h-4 w-4 text-[#00d96f]" />
                      <Badge
                        variant="outline"
                        className="text-[#00d96f] border-[rgba(0,217,111,0.3)] bg-[rgba(0,217,111,0.1)]"
                      >
                        Connection successful
                      </Badge>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-4 w-4 text-[#ff6450]" />
                      <Badge
                        variant="outline"
                        className="text-[#ff6450] border-[rgba(255,100,80,0.3)] bg-[rgba(255,100,80,0.1)]"
                      >
                        Connection failed
                      </Badge>
                    </>
                  )}
                </div>
              )}
            </div>

            {error && (
              <div className="p-3 rounded-md bg-[rgba(255,100,80,0.1)] border border-[rgba(255,100,80,0.3)]">
                <div className="flex items-center gap-2 text-sm text-[#ff6450]">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isLoading}
                className="bg-[#252525] border-[rgba(255,255,255,0.1)] text-[#d0d0d0] hover:bg-[#303030]"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isLoading || !name.trim() || !url.trim()}
                className="min-w-[80px] bg-[#00d4aa] hover:bg-[#14b8a6] text-black border-0 font-semibold"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Adding...
                  </>
                ) : (
                  "Add Agent"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
