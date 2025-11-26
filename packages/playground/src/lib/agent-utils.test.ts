import { describe, it, expect } from "vitest";
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
} from "@/lib/agent-utils";

describe("Agent Utils", () => {
  const mockAgents = [
    {
      id: "agent-1",
      name: "Agent 1",
      url: "http://localhost:8080",
      health: { isOnline: true, lastChecked: Date.now() - 1000 },
      lastChecked: Date.now() - 1000,
    },
    {
      id: "agent-2",
      name: "Agent 2",
      url: "http://localhost:8081",
      health: { isOnline: false, lastChecked: Date.now() - 5000 },
      lastChecked: Date.now() - 5000,
    },
    {
      id: "agent-3",
      name: "Agent 3",
      url: "http://localhost:8082",
      health: { isOnline: true, lastChecked: Date.now() - 2000 },
      lastChecked: Date.now() - 2000,
    },
  ];

  describe("findAgentById", () => {
    it("should find agent by ID", () => {
      const result = findAgentById(mockAgents, "agent-2");
      expect(result).toEqual(mockAgents[1]);
    });

    it("should return undefined for non-existent ID", () => {
      const result = findAgentById(mockAgents, "non-existent");
      expect(result).toBeUndefined();
    });
  });

  describe("findAgentByUrl", () => {
    it("should find agent by URL", () => {
      const result = findAgentByUrl(mockAgents, "http://localhost:8081");
      expect(result).toEqual(mockAgents[1]);
    });

    it("should return undefined for non-existent URL", () => {
      const result = findAgentByUrl(mockAgents, "http://non-existent.com");
      expect(result).toBeUndefined();
    });
  });

  describe("getFirstOnlineAgent", () => {
    it("should return first online agent", () => {
      const result = getFirstOnlineAgent(mockAgents);
      expect(result).toEqual(mockAgents[0]);
    });

    it("should return undefined when no agents are online", () => {
      const offlineAgents = mockAgents.map((agent) => ({
        ...agent,
        health: { ...agent.health, isOnline: false },
      }));
      const result = getFirstOnlineAgent(offlineAgents);
      expect(result).toBeUndefined();
    });
  });

  describe("filterAgentsByStatus", () => {
    it("should filter online agents", () => {
      const result = filterAgentsByStatus(mockAgents, true);
      expect(result).toHaveLength(2);
      expect(result.every((agent) => agent.health?.isOnline)).toBe(true);
    });

    it("should filter offline agents", () => {
      const result = filterAgentsByStatus(mockAgents, false);
      expect(result).toHaveLength(1);
      expect(result.every((agent) => !agent.health?.isOnline)).toBe(true);
    });
  });

  describe("sortAgentsByHealth", () => {
    it("should sort agents by health status (online first)", () => {
      const result = sortAgentsByHealth(mockAgents);
      expect(result[0].health?.isOnline).toBe(true);
      expect(result[1].health?.isOnline).toBe(true);
      expect(result[2].health?.isOnline).toBe(false);
    });

    it("should sort by last checked time when health status is same", () => {
      const result = sortAgentsByHealth(mockAgents);
      // agent-1 was checked more recently than agent-3
      expect(result[0].id).toBe("agent-1");
      expect(result[1].id).toBe("agent-3");
    });
  });

  describe("generateAgentId", () => {
    it("should generate unique IDs", () => {
      const id1 = generateAgentId();
      const id2 = generateAgentId();
      expect(id1).not.toBe(id2);
    });

    it("should use custom prefix", () => {
      const id = generateAgentId("custom");
      expect(id).toMatch(/^custom-/);
    });
  });

  describe("isAgentHealthy", () => {
    it("should return true for healthy agents", () => {
      const healthyAgent = mockAgents[0];
      const result = isAgentHealthy(healthyAgent);
      expect(result).toBe(true);
    });

    it("should return false for offline agents", () => {
      const offlineAgent = mockAgents[1];
      const result = isAgentHealthy(offlineAgent);
      expect(result).toBe(false);
    });

    it("should return false for stale health data", () => {
      const staleAgent = {
        ...mockAgents[0],
        health: { isOnline: true, lastChecked: Date.now() - 10 * 60 * 1000 }, // 10 minutes old
        lastChecked: Date.now() - 10 * 60 * 1000, // Also set agent.lastChecked
      };
      const result = isAgentHealthy(staleAgent);
      expect(result).toBe(false);
    });

    it("should accept custom max age", () => {
      const agent = {
        ...mockAgents[0],
        health: { isOnline: true, lastChecked: Date.now() - 2 * 60 * 1000 }, // 2 minutes old
      };
      const result = isAgentHealthy(agent, 3 * 60 * 1000); // 3 minute max age
      expect(result).toBe(true);
    });
  });

  describe("getAgentHealthSummary", () => {
    it("should return correct health summary", () => {
      const result = getAgentHealthSummary(mockAgents);
      expect(result).toEqual({
        total: 3,
        online: 2,
        offline: 1,
        healthy: 2,
      });
    });

    it("should handle empty array", () => {
      const result = getAgentHealthSummary([]);
      expect(result).toEqual({
        total: 0,
        online: 0,
        offline: 0,
        healthy: 0,
      });
    });
  });

  describe("validateAgent", () => {
    it("should validate complete agent", () => {
      const validAgent = {
        id: "test",
        name: "Test Agent",
        url: "http://test.com",
      };
      const result = validateAgent(validAgent);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect missing fields", () => {
      const invalidAgent = {
        name: "Test Agent",
      };
      const result = validateAgent(invalidAgent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Agent ID is required");
      expect(result.errors).toContain("Agent URL is required");
    });

    it("should detect empty name", () => {
      const invalidAgent = {
        id: "test",
        name: "   ",
        url: "http://test.com",
      };
      const result = validateAgent(invalidAgent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Agent name is required");
    });
  });

  describe("mergeAgentConfigs", () => {
    it("should merge agent configurations", () => {
      const base = {
        id: "test",
        name: "Test Agent",
        url: "http://test.com",
        health: { isOnline: true, lastChecked: 1000 },
      };
      const updates = {
        name: "Updated Agent",
        url: "http://updated.com",
      };
      const result = mergeAgentConfigs(base, updates);
      expect(result.name).toBe("Updated Agent");
      expect(result.url).toBe("http://updated.com");
      expect(result.health).toEqual(base.health); // Should preserve health
    });
  });

  describe("exportAgentsToJson", () => {
    it("should export agents to JSON", () => {
      const result = exportAgentsToJson(mockAgents);
      const parsed = JSON.parse(result);
      expect(parsed).toEqual(mockAgents);
    });
  });

  describe("importAgentsFromJson", () => {
    it("should import agents from JSON", () => {
      const json = JSON.stringify(mockAgents);
      const result = importAgentsFromJson(json);
      expect(result).toEqual(mockAgents);
    });

    it("should filter out invalid agents", () => {
      const invalidData = [
        { id: "valid", name: "Valid", url: "http://valid.com" },
        { name: "Missing ID" },
        { id: "valid2", name: "Valid2", url: "http://valid2.com" },
      ];
      const json = JSON.stringify(invalidData);
      const result = importAgentsFromJson(json);
      expect(result).toHaveLength(2);
      expect(result.every((agent) => agent.id)).toBe(true);
    });

    it("should throw error for invalid JSON", () => {
      expect(() => importAgentsFromJson("invalid json")).toThrow(
        "Invalid JSON format for agents import",
      );
    });
  });

  describe("getRecommendedAgents", () => {
    it("should return recommended agents", () => {
      const result = getRecommendedAgents();
      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("Local Development");
      expect(result[1].name).toBe("Cloudflare Workers");
      expect(result[2].name).toBe("Docker Container");
    });
  });

  describe("createDefaultAgent", () => {
    it("should create default agent", () => {
      const result = createDefaultAgent();
      expect(result.name).toBe("Default Agent");
      expect(result.url).toBe("http://localhost:8787");
      expect(result.health?.isOnline).toBe(false);
    });

    it("should accept overrides", () => {
      const result = createDefaultAgent({
        name: "Custom Agent",
        url: "http://custom.com",
      });
      expect(result.name).toBe("Custom Agent");
      expect(result.url).toBe("http://custom.com");
    });
  });
});

