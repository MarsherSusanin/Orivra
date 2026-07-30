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
  lookup(
    hostname: string,
    options?: { signal?: AbortSignal },
  ): Promise<DnsAnswer[]>;
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
  const words = expandIpv6(address);
  if (!words) return true;

  const [first, second, third, fourth, fifth, sixth, seventh, eighth] = words;
  const allZeroBeforeLast = words.slice(0, 7).every((word) => word === 0);
  if (words.every((word) => word === 0) || (allZeroBeforeLast && eighth === 1)) {
    return true;
  }

  // Reject IPv4 compatibility, mapping, and translation mechanisms. These
  // encodings are easy to reinterpret differently between DNS, policy, and
  // socket layers, so the safe subset accepts native global IPv6 only.
  const firstFiveZero = [first, second, third, fourth, fifth].every(
    (word) => word === 0,
  );
  if (
    (firstFiveZero && (sixth === 0 || sixth === 0xffff)) ||
    (first === 0 && second === 0 && third === 0 && fourth === 0 && fifth === 0xffff) ||
    first === 0x0064 && second === 0xff9b ||
    first === 0x2002 ||
    (first === 0x2001 && second === 0)
  ) {
    return true;
  }

  // Only native global-unicast space is eligible, with documentation,
  // benchmarking, unique-local, link-local, site-local, and multicast denied.
  if ((first & 0xe000) !== 0x2000) return true;
  return (
    (first === 0x2001 && second === 0x0002) ||
    (first === 0x2001 && second === 0x0db8) ||
    (first === 0x2001 && (second & 0xfff0) === 0x0010) ||
    (first === 0x2001 && (second & 0xfff0) === 0x0020) ||
    (first === 0x3fff && (second & 0xf000) === 0) ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xffc0) === 0xfec0 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0x0100 && second === 0 && third === 0 && fourth === 0)
  );
}

function expandIpv6(address: string): number[] | null {
  const lower = address.toLowerCase();
  const dottedAt = lower.lastIndexOf(":");
  let normalized = lower;
  if (lower.includes(".")) {
    if (dottedAt < 0) return null;
    const ipv4 = lower.slice(dottedAt + 1);
    if (isIP(ipv4) !== 4) return null;
    const octets = ipv4.split(".").map(Number);
    normalized = `${lower.slice(0, dottedAt)}:${(
      octets[0] * 256 +
      octets[1]
    ).toString(16)}:${(octets[2] * 256 + octets[3]).toString(16)}`;
  }
  if (normalized.split("::").length > 2) return null;
  const [leftRaw, rightRaw = ""] = normalized.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (
    missing < 0 ||
    (!normalized.includes("::") && missing !== 0) ||
    (normalized.includes("::") && missing < 1)
  ) {
    return null;
  }
  const words = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ].map((word) => Number.parseInt(word, 16));
  if (
    words.length !== 8 ||
    words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)
  ) {
    return null;
  }
  return words;
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
      const controller = new AbortController();
      const timeoutFailure = new Error(
        `Request timeout after ${options.timeoutMs}ms`,
      );
      const timeout = setTimeout(() => {
        controller.abort(timeoutFailure);
      }, options.timeoutMs);
      const aborted = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(controller.signal.reason ?? timeoutFailure),
          { once: true },
        );
      });
      try {
        const answers = await Promise.race([
          options.lookup(url.hostname, { signal: controller.signal }),
          aborted,
        ]);
        if (answers.length === 0) {
          throw new Error("DNS returned no public address");
        }
        for (const answer of answers) assertPublicIpAddress(answer.address);
        const pinnedAddress = answers[0].address;
        const response = await Promise.race([options.dispatch({
          url,
          method: "GET",
          redirect: "error",
          pinnedAddress,
          signal: controller.signal,
          maxResponseBytes: options.maxResponseBytes,
        }), aborted]);

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
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error(`Request timeout after ${options.timeoutMs}ms`, { cause: error });
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
