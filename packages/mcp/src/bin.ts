import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  createOrivraMcpRuntime,
  createOrivraMcpServer,
  parseOrivraMcpConfiguration,
  safeMcpErrorMessage,
} from "./index";

try {
  const configuration = parseOrivraMcpConfiguration(process.env);
  const runtime = createOrivraMcpRuntime({ configuration });
  serveStdio(() => createOrivraMcpServer(runtime), {
    onerror: (error) => console.error(safeMcpErrorMessage(error, configuration.projectToken)),
  });
} catch (error) {
  console.error(safeMcpErrorMessage(error, process.env.PROOFLINE_PROJECT_TOKEN ?? ""));
  process.exitCode = 1;
}
