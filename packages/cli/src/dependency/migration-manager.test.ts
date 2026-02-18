import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MigrationManager, type MigrationResult } from "./migration-manager.js";
import { DryRunManager } from "../utils/dry-run.js";

// Mock child_process
vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

// Mock utils/dry-run
vi.mock("../utils/dry-run.js", () => ({
  DryRunManager: vi.fn(),
}));

describe("MigrationManager", () => {
  let migrationManager: MigrationManager;
  let mockDryRunManager: any;
  let mockExec: any;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();

    // Get the mocked exec function
    const childProcess = await import("child_process");
    mockExec = vi.mocked(childProcess.exec);

    // Setup dry run manager mock
    mockDryRunManager = {
      isEnabled: vi.fn().mockReturnValue(false),
    };

    migrationManager = new MigrationManager(mockDryRunManager);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getDependencyWranglerFlags", () => {
    it("should generate wrangler -c flags for dependencies", () => {
      const dependencies = [
        { name: "dep1", wranglerConfigPath: "/path/to/dep1/wrangler.jsonc" },
        { name: "dep2", wranglerConfigPath: "/path/to/dep2/wrangler.json" },
      ];

      const flags = migrationManager.getDependencyWranglerFlags(dependencies);

      expect(flags).toEqual([
        "-c /path/to/dep1/wrangler.jsonc",
        "-c /path/to/dep2/wrangler.json",
      ]);
    });

    it("should return empty array for no dependencies", () => {
      const flags = migrationManager.getDependencyWranglerFlags([]);
      expect(flags).toEqual([]);
    });
  });

  describe("executeD1MigrationsForDependencies", () => {
    it("should execute D1 migrations for dependencies with D1 databases", async () => {
      const dependencies = [
        { 
          name: "dep1", 
          wranglerConfigPath: "/path/to/dep1/wrangler.jsonc",
          d1Databases: ["DB1", "DB2"]
        },
        { 
          name: "dep2", 
          wranglerConfigPath: "/path/to/dep2/wrangler.jsonc",
          d1Databases: ["DB3"]
        },
      ];

      // Mock successful exec calls
      mockExec.mockImplementation((command: string, options: any, callback: Function) => {
        callback(null, { stdout: "D1 Migration successful", stderr: "" });
      });

      const results = await migrationManager.executeD1MigrationsForDependencies(dependencies);

      expect(results).toHaveLength(3); // 2 + 1 databases
      expect(results[0]).toEqual({
        dependency: "dep1:DB1",
        wranglerConfigPath: "/path/to/dep1/wrangler.jsonc",
        success: true,
      });
      expect(results[1]).toEqual({
        dependency: "dep1:DB2",
        wranglerConfigPath: "/path/to/dep1/wrangler.jsonc",
        success: true,
      });
      expect(results[2]).toEqual({
        dependency: "dep2:DB3",
        wranglerConfigPath: "/path/to/dep2/wrangler.jsonc",
        success: true,
      });

      expect(mockExec).toHaveBeenCalledTimes(3);
      expect(mockExec).toHaveBeenCalledWith(
        "npx wrangler d1 migrations apply DB1 --local --config /path/to/dep1/wrangler.jsonc",
        { cwd: process.cwd(), env: process.env },
        expect.any(Function)
      );
    });

    it("should skip dependencies without D1 databases", async () => {
      const dependencies = [
        { name: "dep1", wranglerConfigPath: "/path/to/dep1/wrangler.jsonc" },
        { name: "dep2", wranglerConfigPath: "/path/to/dep2/wrangler.jsonc", d1Databases: [] },
      ];

      const results = await migrationManager.executeD1MigrationsForDependencies(dependencies);

      expect(results).toHaveLength(0);
      expect(mockExec).not.toHaveBeenCalled();
    });

    it("should handle D1 migration failures gracefully", async () => {
      const dependencies = [
        { 
          name: "failing-dep", 
          wranglerConfigPath: "/path/to/failing/wrangler.jsonc",
          d1Databases: ["FAILING_DB"]
        },
      ];

      // Mock failed exec call
      mockExec.mockImplementation((command: string, options: any, callback: Function) => {
        callback(new Error("D1 command failed"), null);
      });

      const results = await migrationManager.executeD1MigrationsForDependencies(dependencies);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        dependency: "failing-dep:FAILING_DB",
        wranglerConfigPath: "/path/to/failing/wrangler.jsonc",
        success: false,
        error: "Failed to execute D1 migrations for failing-dep:FAILING_DB: D1 command failed",
      });
    });

    it("should handle 'no migrations to apply' gracefully for D1", async () => {
      const dependencies = [
        { 
          name: "up-to-date-dep", 
          wranglerConfigPath: "/path/to/uptodate/wrangler.jsonc",
          d1Databases: ["UP_TO_DATE_DB"]
        },
      ];

      // Mock exec call with "no migrations" message
      mockExec.mockImplementation((command: string, options: any, callback: Function) => {
        const error = new Error("No migrations to apply");
        callback(error, null);
      });

      const results = await migrationManager.executeD1MigrationsForDependencies(dependencies);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        dependency: "up-to-date-dep:UP_TO_DATE_DB",
        wranglerConfigPath: "/path/to/uptodate/wrangler.jsonc",
        success: true,
      });
    });

    it("should handle 'already applied' message gracefully for D1", async () => {
      const dependencies = [
        { 
          name: "current-dep", 
          wranglerConfigPath: "/path/to/current/wrangler.jsonc",
          d1Databases: ["CURRENT_DB"]
        },
      ];

      // Mock exec call with "already applied" message
      mockExec.mockImplementation((command: string, options: any, callback: Function) => {
        const error = new Error("already applied");
        callback(error, null);
      });

      const results = await migrationManager.executeD1MigrationsForDependencies(dependencies);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        dependency: "current-dep:CURRENT_DB",
        wranglerConfigPath: "/path/to/current/wrangler.jsonc",
        success: true,
      });
    });

    it("should log D1 migration stdout and stderr", async () => {
      const dependencies = [
        { 
          name: "verbose-dep", 
          wranglerConfigPath: "/path/to/verbose/wrangler.jsonc",
          d1Databases: ["VERBOSE_DB"]
        },
      ];

      // Mock exec call with stdout and stderr
      mockExec.mockImplementation((command: string, options: any, callback: Function) => {
        callback(null, { 
          stdout: "D1 Migration output here", 
          stderr: "Warning: some D1 warning"
        });
      });

      const results = await migrationManager.executeD1MigrationsForDependencies(dependencies);

      expect(results[0].success).toBe(true);
    });
  });

  describe("dry run mode", () => {
    beforeEach(() => {
      mockDryRunManager.isEnabled.mockReturnValue(true);
      migrationManager = new MigrationManager(mockDryRunManager);
    });

    it("should not execute D1 commands in dry run mode", async () => {
      const dependencies = [
        { 
          name: "dry-run-dep", 
          wranglerConfigPath: "/path/to/dryrun/wrangler.jsonc",
          d1Databases: ["DRY_RUN_DB"]
        },
      ];

      const results = await migrationManager.executeD1MigrationsForDependencies(dependencies);

      expect(results[0].success).toBe(true);
      expect(mockExec).not.toHaveBeenCalled();
    });
  });

  describe("without dry run manager", () => {
    beforeEach(() => {
      migrationManager = new MigrationManager(); // No dry run manager
    });

    it("should execute D1 migrations normally without dry run manager", async () => {
      const dependencies = [
        { 
          name: "normal-dep", 
          wranglerConfigPath: "/path/to/normal/wrangler.jsonc",
          d1Databases: ["NORMAL_DB"]
        },
      ];

      mockExec.mockImplementation((command: string, options: any, callback: Function) => {
        callback(null, { stdout: "D1 Success", stderr: "" });
      });

      const results = await migrationManager.executeD1MigrationsForDependencies(dependencies);

      expect(results[0].success).toBe(true);
      expect(mockExec).toHaveBeenCalledTimes(1);
    });
  });
});