import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./rpc.js";
await createMcpServer(loadConfig()).connect(new StdioServerTransport());
