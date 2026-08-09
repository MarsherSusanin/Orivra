import {
  AccountTokenCreateRequestV1Schema,
  AccountTokenCreatedV1Schema,
  AccountTokenRevokedV1Schema,
  AccountV1Schema,
  NetworkCapabilitiesV1Schema,
  WalletChallengeRequestV1Schema,
  WalletChallengeV1Schema,
  WalletSessionRequestV1Schema,
  WalletSessionV1Schema,
  type AccountTokenCreateRequestV1,
  type AccountTokenCreatedV1,
  type AccountTokenRevokedV1,
  type AccountV1,
  type NetworkCapabilitiesV1,
  type WalletChallengeRequestV1,
  type WalletChallengeV1,
  type WalletSessionRequestV1,
  type WalletSessionV1,
} from "@proofline/contracts";
import type { z } from "zod";

const PROJECT_TOKEN = /^project_[a-f0-9]{64}$/;
const ACCOUNT_TOKEN_ID = /^token_[a-f0-9]{32}$/;
const TOKEN_ISSUANCE_KEY = /^token_issue_[a-f0-9]{64}$/;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

export type WalletAccessErrorKind =
  | "http"
  | "transport"
  | "contract"
  | "input";

const ERROR_MESSAGES: Record<WalletAccessErrorKind, string> = {
  input: "Proofline request input is invalid.",
  contract: "Proofline returned an invalid response.",
  http: "Proofline request failed.",
  transport: "Proofline is unavailable. Retry safely.",
};

export class WalletAccessError extends Error {
  readonly kind: WalletAccessErrorKind;
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(input: {
    kind: WalletAccessErrorKind;
    status: number;
    code: string;
    retryable: boolean;
  }) {
    super(ERROR_MESSAGES[input.kind]);
    this.name = "WalletAccessError";
    this.kind = input.kind;
    this.status = input.status;
    this.code = input.code;
    this.retryable = input.retryable;
  }
}

export type WalletAccessServices = {
  listNetworks(): Promise<NetworkCapabilitiesV1>;
  createWalletChallenge(
    request: WalletChallengeRequestV1,
  ): Promise<WalletChallengeV1>;
  createWalletSession(
    request: WalletSessionRequestV1,
  ): Promise<WalletSessionV1>;
  getAccount(input: { projectToken: string }): Promise<AccountV1>;
  createAccountToken(input: {
    projectToken: string;
    idempotencyKey: string;
    request: AccountTokenCreateRequestV1;
  }): Promise<AccountTokenCreatedV1>;
  revokeAccountToken(input: {
    projectToken: string;
    tokenId: string;
  }): Promise<AccountTokenRevokedV1>;
  revokeCurrentSession(input: { projectToken: string }): Promise<void>;
};

function inputError(): WalletAccessError {
  return new WalletAccessError({
    kind: "input",
    status: 0,
    code: "AUTH_INPUT_INVALID",
    retryable: false,
  });
}

function contractError(): WalletAccessError {
  return new WalletAccessError({
    kind: "contract",
    status: 502,
    code: "AUTH_RESPONSE_INVALID",
    retryable: false,
  });
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw inputError();
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw inputError();
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = pathname.endsWith("/v1") ? pathname : `${pathname}/v1`;
  return url.toString().replace(/\/$/, "");
}

function requireProjectToken(value: unknown): string {
  if (typeof value !== "string" || !PROJECT_TOKEN.test(value)) {
    throw inputError();
  }
  return value;
}

function requirePattern(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) throw inputError();
  return value;
}

function requireSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw inputError();
  return result.data;
}

async function httpError(response: Response): Promise<WalletAccessError> {
  let code = `HTTP_${response.status}`;
  try {
    const value: unknown = await response.json();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const error = (value as Record<string, unknown>).error;
      if (error && typeof error === "object" && !Array.isArray(error)) {
        const candidate = (error as Record<string, unknown>).code;
        if (typeof candidate === "string" && SAFE_ERROR_CODE.test(candidate)) {
          code = candidate;
        }
      }
    }
  } catch {
    // The public error uses only status-derived evidence when JSON is invalid.
  }
  return new WalletAccessError({
    kind: "http",
    status: response.status,
    code,
    retryable:
      response.status >= 500 || response.status === 408 || response.status === 429,
  });
}

export function createWalletAccessClient(input: {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}): WalletAccessServices {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const fetchPort = input.fetch ?? globalThis.fetch.bind(globalThis);

  async function send(input: {
    path: string;
    method: "GET" | "POST" | "DELETE";
    expectedStatus: number;
    projectToken?: string;
    idempotencyKey?: string;
    body?: unknown;
  }): Promise<Response> {
    const headers = new Headers({ accept: "application/json" });
    if (input.projectToken !== undefined) {
      headers.set("authorization", `Bearer ${input.projectToken}`);
    }
    if (input.idempotencyKey !== undefined) {
      headers.set("idempotency-key", input.idempotencyKey);
    }
    if (input.body !== undefined) headers.set("content-type", "application/json");

    let response: Response;
    try {
      response = await fetchPort(`${baseUrl}${input.path}`, {
        method: input.method,
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        credentials: "omit",
        mode: "cors",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
    } catch {
      throw new WalletAccessError({
        kind: "transport",
        status: 0,
        code: "TRANSPORT_UNAVAILABLE",
        retryable: true,
      });
    }
    if (!response.ok) throw await httpError(response);
    if (response.status !== input.expectedStatus) throw contractError();
    return response;
  }

  async function parseResponse<T>(
    response: Response,
    schema: z.ZodType<T>,
  ): Promise<T> {
    try {
      const parsed = schema.safeParse(await response.json());
      if (!parsed.success) throw contractError();
      return parsed.data;
    } catch (cause) {
      if (cause instanceof WalletAccessError) throw cause;
      throw contractError();
    }
  }

  return {
    async listNetworks() {
      const response = await send({
        path: "/networks",
        method: "GET",
        expectedStatus: 200,
      });
      return parseResponse(response, NetworkCapabilitiesV1Schema);
    },

    async createWalletChallenge(rawRequest) {
      const request = requireSchema(WalletChallengeRequestV1Schema, rawRequest);
      const response = await send({
        path: "/auth/wallet/challenges",
        method: "POST",
        expectedStatus: 201,
        body: request,
      });
      return parseResponse(response, WalletChallengeV1Schema);
    },

    async createWalletSession(rawRequest) {
      const request = requireSchema(WalletSessionRequestV1Schema, rawRequest);
      const response = await send({
        path: "/auth/wallet/sessions",
        method: "POST",
        expectedStatus: 201,
        body: request,
      });
      return parseResponse(response, WalletSessionV1Schema);
    },

    async getAccount(input) {
      const projectToken = requireProjectToken(input.projectToken);
      const response = await send({
        path: "/account",
        method: "GET",
        expectedStatus: 200,
        projectToken,
      });
      return parseResponse(response, AccountV1Schema);
    },

    async createAccountToken(input) {
      const projectToken = requireProjectToken(input.projectToken);
      const idempotencyKey = requirePattern(
        input.idempotencyKey,
        TOKEN_ISSUANCE_KEY,
      );
      const request = requireSchema(AccountTokenCreateRequestV1Schema, input.request);
      const response = await send({
        path: "/account/tokens",
        method: "POST",
        expectedStatus: 201,
        projectToken,
        idempotencyKey,
        body: request,
      });
      return parseResponse(response, AccountTokenCreatedV1Schema);
    },

    async revokeAccountToken(input) {
      const projectToken = requireProjectToken(input.projectToken);
      const tokenId = requirePattern(input.tokenId, ACCOUNT_TOKEN_ID);
      const response = await send({
        path: `/account/tokens/${tokenId}`,
        method: "DELETE",
        expectedStatus: 200,
        projectToken,
      });
      return parseResponse(response, AccountTokenRevokedV1Schema);
    },

    async revokeCurrentSession(input) {
      const projectToken = requireProjectToken(input.projectToken);
      const response = await send({
        path: "/auth/wallet/sessions/current",
        method: "DELETE",
        expectedStatus: 204,
        projectToken,
      });
      try {
        if ((await response.arrayBuffer()).byteLength !== 0) throw contractError();
      } catch (cause) {
        if (cause instanceof WalletAccessError) throw cause;
        throw contractError();
      }
    },
  };
}
