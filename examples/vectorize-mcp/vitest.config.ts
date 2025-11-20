import { createMcpWorkersConfig } from "@nullshot/test-utils/vitest/mcpWorkersConfig";

export default createMcpWorkersConfig({
  test: { deps: { optimizer: { ssr: { include: ["http-errors"] } } } },
});

