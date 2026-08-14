export type OrivraMcpConfiguration = Readonly<{
  apiUrl: string;
  projectToken: string;
}>;

const PROJECT_TOKEN = /^project_[a-f0-9]{64}$/;

export function parseOrivraMcpConfiguration(
  environment: Record<string, string | undefined>,
): OrivraMcpConfiguration {
  const rawUrl = environment.PROOFLINE_API_URL;
  const projectToken = environment.PROOFLINE_PROJECT_TOKEN;
  if (!rawUrl || !projectToken || !PROJECT_TOKEN.test(projectToken)) {
    throw new Error("Orivra MCP configuration is invalid");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Orivra MCP configuration is invalid");
  }
  if (
    url.protocol !== "https:" ||
    (url.port !== "" && url.port !== "443") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname.length > 512
  ) {
    throw new Error("Orivra MCP configuration is invalid");
  }
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/v1") ? path : `${path}/v1`;
  return Object.freeze({ apiUrl: url.toString().replace(/\/$/, ""), projectToken });
}
