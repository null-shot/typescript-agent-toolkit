"use client";

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
import { cn } from "@/lib/utils";
import { 
  saveCustomAgent, 
  validateAgentUrl, 
  testAgentConnection,
  type CustomAgent 
} from "@/lib/agent-storage";

interface AddAgentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAgentAdded: (agent: CustomAgent) => void;
}

export function AddAgentModal({ 
  open, 
  onOpenChange, 
  onAgentAdded 
}: AddAgentModalProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<{
    tested: boolean;
    online: boolean;
    error?: string;
  }>({ tested: false, online: false });
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setName("");
    setUrl("");
    setError(null);
    setConnectionStatus({ tested: false, online: false });
    setIsLoading(false);
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
    } catch (err) {
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

    setIsLoading(true);
    setError(null);

    try {
      const newAgent = saveCustomAgent(name.trim(), url.trim());
      onAgentAdded(newAgent);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save agent");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogPortal>
        {/* Custom solid overlay */}
        <DialogOverlay className="bg-black/90 backdrop-blur-sm" />
        <DialogContent 
          className="sm:max-w-md bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 shadow-2xl"
          showCloseButton={true}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
              <Plus className="h-5 w-5" />
              Add New Agent
            </DialogTitle>
            <DialogDescription className="text-gray-600 dark:text-gray-300">
              Add a custom agent by providing a name and URL. The URL should point to a running agent instance.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="agent-name" className="text-gray-900 dark:text-white font-medium">Agent Name</Label>
              <Input
                id="agent-name"
                placeholder="My Custom Agent"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="agent-url" className="text-gray-900 dark:text-white font-medium">Agent URL</Label>
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
                  className="flex-1 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={testConnection}
                  disabled={!url.trim() || isTestingConnection}
                  className="shrink-0 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700"
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
                      <Check className="h-4 w-4 text-green-500" />
                      <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 dark:bg-green-900/20">
                        Connection successful
                      </Badge>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-4 w-4 text-red-500" />
                      <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50 dark:bg-red-900/20">
                        Connection failed
                      </Badge>
                    </>
                  )}
                </div>
              )}
            </div>

            {error && (
              <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-600">
                <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
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
                className="bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isLoading || !name.trim() || !url.trim()}
                className="min-w-[80px] bg-blue-600 hover:bg-blue-700 text-white border-0"
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
