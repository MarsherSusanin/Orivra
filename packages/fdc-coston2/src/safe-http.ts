import { isIP } from "node:net";

export interface DnsAnswer {
  address: string;
  family: 4 | 6;
}

export interface SafeDispatchRequest {
  url: URL;
  method: "GET";
  redirect: "error";
  pinnedAddress: string;
  signal: AbortSignal;
  maxResponseBytes: number;
}

export interface SafeDispatchResponse {
  status: number;
  connectedAddress: string;
  headers: Record<string, string | undefined>;
  body: Uint8Array;
}

export interface SafeHttpFetcherOptions {
  lookup(hostname: string): Promise<DnsAnswer[]>;
  dispatch(request: SafeDispatchRequest): Promise<SafeDispatchResponse>;
  timeoutMs: number;
  maxResponseBytes: number;
}

export function assertSafeWeb2JsonUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Web2Json source must be an absolute public HTTPS URL");
  }
  if (
    url.protocol !== "https:" ||
    (url.port !== "" && url.port !== "443") ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.hostname === ""
  ) {
    throw new Error("Web2Json source must use public HTTPS on port 443 without credentials or fragments");
  }
  return url;
}

function ipv4Number(address: string): number {
  return address
    .split(".")
    .reduce((value, octet) => (value * 256 + Number(octet)) >>> 0, 0);
}

function inV4Range(value: number, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (ipv4Number(base) & mask);
}

function denyIpv4(address: string): boolean {
  const value = ipv4Number(address);
  return [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ].some(([base, prefix]) => inV4Range(value, String(base), Number(prefix)));
}

function denyIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice(7);
    if (isIP(mapped) === 4) return denyIpv4(mapped);
    const parts = mapped.split(":");
    if (parts.length === 2) {
      const high = Number.parseInt(parts[0], 16);
      const low = Number.parseInt(parts[1], 16);
      return denyIpv4(
        `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`,
      );
    }
    return true;
  }
  const first = Number.parseInt(lower.split(":")[0] || "0", 16);
  return (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xffc0) === 0xfec0 ||
    (first & 0xff00) === 0xff00 ||
    lower.startsWith("2001:db8:")
  );
}

export function assertPublicIpAddress(address: string): string {
  const family = isIP(address);
  if (
    family === 0 ||
    (family === 4 && denyIpv4(address)) ||
    (family === 6 && denyIpv6(address))
  ) {
    throw new Error(`SSRF policy requires a public IP address: ${address}`);
  }
  return address;
}

export function createSafeHttpFetcher(options: SafeHttpFetcherOptions) {
  if (options.timeoutMs <= 0 || options.maxResponseBytes <= 0) {
    throw new Error("Safe HTTP bounds must be positive");
  }
  return {
    async getJson(source: string): Promise<unknown> {
      const url = assertSafeWeb2JsonUrl(source);
      const answers = await options.lookup(url.hostname);
      if (answers.length === 0) throw new Error("DNS returned no public address");
      for (const answer of answers) assertPublicIpAddress(answer.address);
      const pinnedAddress = answers[0].address;
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error(`Request timeout after ${options.timeoutMs}ms`)),
        options.timeoutMs,
      );
      let response: SafeDispatchResponse;
      try {
        response = await options.dispatch({
          url,
          method: "GET",
          redirect: "error",
          pinnedAddress,
          signal: controller.signal,
          maxResponseBytes: options.maxResponseBytes,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error(`Request timeout after ${options.timeoutMs}ms`, { cause: error });
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }

      if (response.connectedAddress !== pinnedAddress) {
        throw new Error("Connected address does not match the pinned DNS answer; possible rebinding");
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        throw new Error("Web2Json redirects are forbidden");
      }
      const contentLength = Number(response.headers["content-length"] ?? 0);
      if (
        contentLength > options.maxResponseBytes ||
        response.body.byteLength > options.maxResponseBytes
      ) {
        throw new Error(`Web2Json response exceeds ${options.maxResponseBytes} bytes (1 MiB cap)`);
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Web2Json source returned HTTP ${response.status}`);
      }
      return JSON.parse(new TextDecoder().decode(response.body));
    },
  };
}
