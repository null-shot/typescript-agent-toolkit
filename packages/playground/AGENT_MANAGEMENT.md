# Agent Management System

This document describes the new React Context-based agent management system that replaces the hardcoded `getAllAgents()` function with a flexible, configurable system.

## Overview

The agent management system provides a React Context-based approach for managing AI agents in your application. It supports:

- **Dynamic agent configuration** - Add/remove agents at runtime
- **Persistent storage** - Agents are saved to localStorage
- **Health monitoring** - Automatic health checks for all agents
- **Easy configuration** - Simple declarative configuration components
- **Backward compatibility** - Existing code continues to work

## Quick Start

### 1. Wrap your app with the Agent Provider

```tsx
import { AgentConfigProvider } from "@/lib/agent-config"

function App() {
  return (
    <AgentConfigProvider>
      <YourApp />
    </AgentConfigProvider>
  )
}
```

### 2. Use agents in your components

```tsx
import { useAgentSelection } from "@/lib/agent-context"

function MyComponent() {
  const { agents, selectedAgent, selectAgent } = useAgentSelection()
  
  return (
    <div>
      <h2>Available Agents:</h2>
      {agents.map(agent => (
        <div key={agent.id}>
          <span>{agent.name}</span>
          <span>Status: {agent.health?.isOnline ? "Online" : "Offline"}</span>
        </div>
      ))}
    </div>
  )
}
```

### 3. Add new agents

```tsx
import { useAgentManagement } from "@/lib/agent-context"

function AddAgentForm() {
  const { addAgent, isLoading, error } = useAgentManagement()
  
  const handleSubmit = async (e) => {
    e.preventDefault()
    const formData = new FormData(e.target)
    const result = await addAgent(
      formData.get("name"),
      formData.get("url")
    )
    
    if (result.success) {
      console.log("Agent added successfully!")
    } else {
      console.error("Failed to add agent:", result.error)
    }
  }
  
  return (
    <form onSubmit={handleSubmit}>
      <input name="name" placeholder="Agent Name" required />
      <input name="url" placeholder="Agent URL" required />
      <button type="submit" disabled={isLoading}>
        {isLoading ? "Adding..." : "Add Agent"}
      </button>
      {error && <div className="error">{error}</div>}
    </form>
  )
}
```

## Configuration Options

### Basic Configuration

```tsx
<AgentConfigProvider
  agents={[
    { id: "agent-1", name: "My Agent", url: "http://localhost:8080" },
    { id: "agent-2", name: "Backup Agent", url: "http://localhost:8081" },
  ]}
  persistToLocalStorage={true}
>
  <YourApp />
</AgentConfigProvider>
```

### Pre-configured Setups

```tsx
// Development environment
<DevelopmentAgentConfig>
  <YourApp />
</DevelopmentAgentConfig>

// Production environment  
<ProductionAgentConfig>
  <YourApp />
</ProductionAgentConfig>

// Minimal configuration (just default agent)
<MinimalAgentConfig>
  <YourApp />
</MinimalAgentConfig>

// Use recommended agents
<RecommendedAgentConfig>
  <YourApp />
</RecommendedAgentConfig>
```

### Custom Configuration

```tsx
<AgentConfigProvider
  agents={customAgents}
  persistToLocalStorage={true}
  useRecommendedAgents={false}
  providerProps={{
    // Additional AgentProvider props
  }}
>
  <YourApp />
</AgentConfigProvider>
```

## API Reference

### Hooks

#### `useAgentContext()`
Returns the full agent context state and actions.

```tsx
const {
  agents,
  selectedAgentId,
  isLoading,
  error,
  addAgent,
  removeAgent,
  selectAgent,
  updateAgentHealth,
  refreshAgents,
  setAgents,
  resetAgents,
} = useAgentContext()
```

#### `useAgentSelection()`
Returns agent selection state and actions.

```tsx
const { agents, selectedAgent, selectedAgentId, selectAgent } = useAgentSelection()
```

#### `useAgentManagement()`
Returns agent management actions and state.

```tsx
const { addAgent, removeAgent, refreshAgents, isLoading, error } = useAgentManagement()
```

#### `useAgentConfig()`
Returns configuration values.

```tsx
const { maxAgents, healthCheckInterval, connectionTimeout, enableAutoRefresh, enableNotifications } = useAgentConfig()
```

### Utility Functions

```tsx
import {
  findAgentById,
  findAgentByUrl,
  getFirstOnlineAgent,
  filterAgentsByStatus,
  sortAgentsByHealth,
  generateAgentId,
  isAgentHealthy,
  getAgentHealthSummary,
  validateAgent,
  mergeAgentConfigs,
  exportAgentsToJson,
  importAgentsFromJson,
  getRecommendedAgents,
  createDefaultAgent,
} from "@/lib/agent-utils"
```

### Persistence

```tsx
import { createAgentStorage, LocalStorageAgentStorage, MemoryAgentStorage } from "@/lib/agent-persistence"

// Create storage instance
const storage = createAgentStorage()

// Use localStorage (default)
const localStorage = new LocalStorageAgentStorage()

// Use memory storage (fallback)
const memoryStorage = new MemoryAgentStorage()
```

## Migration Guide

### From `getAllAgents()`

**Before:**
```tsx
import { getAllAgents } from "@/lib/config"

function MyComponent() {
  const agents = getAllAgents()
  // ...
}
```

**After:**
```tsx
import { useAgentSelection } from "@/lib/agent-context"

function MyComponent() {
  const { agents } = useAgentSelection()
  // ...
}
```

### From hardcoded agents

**Before:**
```tsx
const agents = [
  { id: "1", name: "Agent 1", url: "http://localhost:8080" },
  { id: "2", name: "Agent 2", url: "http://localhost:8081" },
]
```

**After:**
```tsx
<AgentConfigProvider
  agents={[
    { id: "1", name: "Agent 1", url: "http://localhost:8080" },
    { id: "2", name: "Agent 2", url: "http://localhost:8081" },
  ]}
>
  <YourApp />
</AgentConfigProvider>
```

## Examples

### Complete Example Application

```tsx
import React from "react"
import { AgentConfigProvider, useAgentSelection, useAgentManagement } from "@/lib/agent-config"
import { AgentSelector } from "@/components/agent-selector"
import { AddAgentModal } from "@/components/add-agent-modal"

function AgentDashboard() {
  const { agents, selectedAgent } = useAgentSelection()
  const { refreshAgents, isLoading } = useAgentManagement()
  
  React.useEffect(() => {
    // Refresh agent health on mount
    refreshAgents()
  }, [])
  
  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Agent Dashboard</h1>
        <button 
          onClick={refreshAgents} 
          disabled={isLoading}
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          {isLoading ? "Refreshing..." : "Refresh All"}
        </button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map(agent => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  )
}

function AgentCard({ agent }) {
  return (
    <div className="border rounded-lg p-4">
      <h3 className="font-semibold">{agent.name}</h3>
      <p className="text-sm text-gray-600">{agent.url}</p>
      <div className="mt-2">
        <span className={`inline-block px-2 py-1 rounded text-xs ${
          agent.health?.isOnline 
            ? "bg-green-100 text-green-800" 
            : "bg-red-100 text-red-800"
        }`}>
          {agent.health?.isOnline ? "Online" : "Offline"}
        </span>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AgentConfigProvider>
      <AgentDashboard />
    </AgentConfigProvider>
  )
}
```

### Custom Agent Configuration

```tsx
import { AgentConfigProvider } from "@/lib/agent-config"

function CustomApp() {
  const customAgents = [
    {
      id: "production-1",
      name: "Production Agent",
      url: "https://agent.your-domain.com",
    },
    {
      id: "staging-1", 
      name: "Staging Agent",
      url: "https://staging-agent.your-domain.com",
    },
  ]
  
  return (
    <AgentConfigProvider
      agents={customAgents}
      persistToLocalStorage={true}
      useRecommendedAgents={false}
    >
      <YourApp />
    </AgentConfigProvider>
  )
}
```

### Environment-based Configuration

```tsx
import { createConfigFromEnv } from "@/lib/agent-config"

function EnvBasedApp() {
  const config = createConfigFromEnv()
  
  return (
    <AgentConfigProvider {...config}>
      <YourApp />
    </AgentConfigProvider>
  )
}
```

Set environment variables:
```bash
NEXT_PUBLIC_AGENTS='[{"id":"env-1","name":"Env Agent","url":"http://localhost:8080"}]'
NEXT_PUBLIC_PERSIST_AGENTS=true
NEXT_PUBLIC_USE_RECOMMENDED_AGENTS=false
```

## Testing

The agent management system includes comprehensive tests:

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with UI
pnpm test:ui
```

### Test Coverage

- **Agent Context**: 16 tests covering context state, actions, and error handling
- **Agent Utils**: 29 tests covering utility functions
- **Persistence**: Tests for localStorage and memory storage
- **Integration**: Tests for component integration

## Troubleshooting

### Common Issues

1. **"useAgentContext must be used within an AgentProvider"**
   - Ensure your component is wrapped with `AgentProvider` or `AgentConfigProvider`

2. **Agents not persisting**
   - Check that `persistToLocalStorage={true}` is set
   - Verify localStorage is available in your environment

3. **Health checks failing**
   - Ensure agent URLs are accessible
   - Check network connectivity
   - Verify CORS settings for cross-origin requests

4. **Duplicate agent errors**
   - Each agent must have a unique ID and URL
   - Use `generateAgentId()` for creating unique IDs

### Debug Mode

Enable debug logging:

```tsx
const { setAgents, agents } = useAgentContext()

// Log current state
console.log("Current agents:", agents)

// Set up debug logging
setAgents([
  ...agents,
  { id: "debug", name: "Debug Agent", url: "http://localhost:9999" }
])
```

## Advanced Usage

### Custom Storage Implementation

```tsx
import { AgentStorage } from "@/lib/agent-persistence"

class CustomStorage implements AgentStorage {
  saveAgents(agents: Agent[]): void {
    // Custom save logic
  }
  
  loadAgents(): Agent[] {
    // Custom load logic
    return []
  }
  
  // ... implement other methods
}
```

### Custom Health Monitoring

```tsx
import { useAgentContext } from "@/lib/agent-context"

function CustomHealthMonitor() {
  const { agents, updateAgentHealth } = useAgentContext()
  
  React.useEffect(() => {
    const interval = setInterval(() => {
      agents.forEach(agent => {
        // Custom health check logic
        const health = checkCustomHealth(agent)
        updateAgentHealth(agent.id, health)
      })
    }, 60000) // Check every minute
    
    return () => clearInterval(interval)
  }, [agents])
  
  return null
}
```

### Agent Import/Export

```tsx
import { exportAgentsToJson, importAgentsFromJson } from "@/lib/agent-utils"

function AgentImportExport() {
  const { agents, setAgents } = useAgentContext()
  
  const handleExport = () => {
    const json = exportAgentsToJson(agents)
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "agents-backup.json"
    a.click()
  }
  
  const handleImport = (event) => {
    const file = event.target.files[0]
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const importedAgents = importAgentsFromJson(e.target.result)
        setAgents(importedAgents)
      } catch (error) {
        console.error("Failed to import agents:", error)
      }
    }
    reader.readAsText(file)
  }
  
  return (
    <div>
      <button onClick={handleExport}>Export Agents</button>
      <input type="file" accept=".json" onChange={handleImport} />
    </div>
  )
}
```

## Contributing

When adding new features to the agent management system:

1. **Add tests** - Ensure comprehensive test coverage
2. **Update documentation** - Keep this README up to date
3. **Maintain backward compatibility** - Don't break existing APIs
4. **Follow patterns** - Use consistent patterns with existing code
5. **Handle errors** - Always handle edge cases and errors

## Migration Checklist

- [ ] Update imports from `@/lib/config` to `@/lib/agent-context`
- [ ] Replace `getAllAgents()` calls with `useAgentSelection()`
- [ ] Wrap components with `AgentConfigProvider`
- [ ] Update agent addition logic to use `addAgent()`
- [ ] Test persistence functionality
- [ ] Verify health monitoring works
- [ ] Update error handling
- [ ] Test cross-tab synchronization
- [ ] Verify backward compatibility

## Support

For issues and questions:

1. Check the troubleshooting section above
2. Review the test files for usage examples
3. Check existing issues in the repository
4. Create a new issue with detailed information