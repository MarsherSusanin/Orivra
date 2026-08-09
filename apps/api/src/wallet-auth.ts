import { isCanonicalAuthTimestampV1 } from "@proofline/contracts/wallet-auth";

const WALLET_ADDRESS = /^0x[0-9a-f]{40}$/i;
const WALLET_SIGNATURE = /^0x[0-9a-f]{130}$/i;
const SERVER_NONCE = /^[a-f0-9]{64}$/;
const CHALLENGE_DURATION_MILLISECONDS = 5 * 60_000;
const MAX_MESSAGE_BYTES = 8_192;

function normalizeWalletAddress(value: string): `0x${string}` {
  if (!WALLET_ADDRESS.test(value)) {
    throw new Error("Wallet address must contain exactly twenty hexadecimal bytes");
  }
  return `0x${value.slice(2).toLowerCase()}`;
}

function normalizeWebOrigin(value: string): URL {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error("Web origin must be a valid HTTPS root origin");
  }
  if (
    origin.protocol !== "https:" ||
    (origin.port !== "" && origin.port !== "443") ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    throw new Error("Web origin must be an HTTPS default-port root origin");
  }
  return origin;
}

function timestamp(value: string, label: string): number {
  if (!isCanonicalAuthTimestampV1(value)) {
    throw new Error(`${label} timestamp must be canonical millisecond UTC`);
  }
  return Date.parse(value);
}

export function buildEip4361Message(input: {
  webOrigin: string;
  address: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  purpose: "browser-session";
}): string {
  if (input.purpose !== "browser-session") {
    throw new Error("Wallet challenge purpose is not supported");
  }
  if (!SERVER_NONCE.test(input.nonce)) {
    throw new Error("Wallet challenge nonce must be 256-bit lowercase hexadecimal");
  }
  const issuedAt = timestamp(input.issuedAt, "Issued At");
  const expiresAt = timestamp(input.expiresAt, "Expiration Time");
  if (expiresAt - issuedAt !== CHALLENGE_DURATION_MILLISECONDS) {
    throw new Error("Wallet challenge must expire exactly five minutes after issue");
  }

  const webOrigin = normalizeWebOrigin(input.webOrigin);
  const address = normalizeWalletAddress(input.address);
  const message = [
    `${webOrigin.host} wants you to sign in with your Ethereum account:`,
    address,
    "",
    "Sign in to Proofline and create your default project.",
    "",
    `URI: ${webOrigin.origin}`,
    "Version: 1",
    "Chain ID: 114",
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expiresAt}`,
  ].join("\n");
  if (new TextEncoder().encode(message).byteLength > MAX_MESSAGE_BYTES) {
    throw new Error("EIP-4361 message exceeds the 8192-byte limit");
  }
  return message;
}

export async function verifyEoaWalletSignature(
  input: {
    expectedAddress: string;
    message: string;
    signature: string;
  },
  ports: {
    recoverAddress(input: {
      message: string;
      signature: string;
    }): Promise<string>;
  },
): Promise<boolean> {
  const expectedAddress = normalizeWalletAddress(input.expectedAddress);
  if (
    input.message.length === 0 ||
    new TextEncoder().encode(input.message).byteLength > MAX_MESSAGE_BYTES ||
    !WALLET_SIGNATURE.test(input.signature)
  ) {
    return false;
  }
  try {
    const recovered = await ports.recoverAddress({
      message: input.message,
      signature: input.signature,
    });
    return normalizeWalletAddress(recovered) === expectedAddress;
  } catch {
    return false;
  }
}
