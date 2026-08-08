import {
  Coston2Web2JsonManifestV1Schema,
  type Web2JsonManifestV1,
} from "@proofline/contracts";
import { request, type Dispatcher } from "undici";
import { createFdcError, normalizeFdcError } from "./errors";

const PREPARE_PATH = "/verifier/web2/Web2Json/prepareRequest";

export function toBytes32Utf8(value: string): `0x${string}` {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 32) throw new Error("Value exceeds 32 bytes");
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}${"00".repeat(32 - bytes.length)}`;
}

export interface Web2JsonVerifierClientOptions {
  endpoint: string;
  apiKey: string;
  dispatcher?: Dispatcher;
}

export function createWeb2JsonVerifierClient(options: Web2JsonVerifierClientOptions) {
  const attestationType = toBytes32Utf8("Web2Json");
  const sourceId = toBytes32Utf8("PublicWeb2");
  return {
    async prepareRequest(manifest: Web2JsonManifestV1) {
      const coston2Manifest = Coston2Web2JsonManifestV1Schema.parse(manifest);
      const payload = {
        attestationType,
        sourceId,
        requestBody: {
          url: coston2Manifest.request.url,
          httpMethod: "GET",
          headers: "{}",
          queryParams: JSON.stringify(coston2Manifest.request.query),
          body: "{}",
          postProcessJq: coston2Manifest.request.jq,
          abiSignature: coston2Manifest.request.abiSignature,
        },
      };
      let decoded: unknown;
      let statusCode: number | undefined;
      try {
        const response = await request(
          `${options.endpoint.replace(/\/+$/, "")}${PREPARE_PATH}`,
          {
            method: "POST",
            dispatcher: options.dispatcher,
            headers: {
              "content-type": "application/json",
              "x-api-key": options.apiKey,
            },
            body: JSON.stringify(payload),
          },
        );
        statusCode = response.statusCode;
        decoded = await response.body.json();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message.split(options.apiKey).join("[REDACTED]")
            : "Verifier transport failed";
        throw normalizeFdcError(new Error(message), {
          operation: "prepareRequest",
          endpoint: options.endpoint,
          statusCode,
        });
      }

      if (statusCode === undefined || statusCode < 200 || statusCode >= 300) {
        throw createFdcError(
          "transport",
          "VERIFIER_HTTP_STATUS",
          `Verifier returned HTTP ${statusCode ?? "unknown"}`,
          true,
          {
            operation: "prepareRequest",
            endpoint: options.endpoint,
            statusCode,
          },
        );
      }

      const response = decoded as Record<string, unknown>;
      const verifierStatus =
        typeof response?.status === "string" ? response.status : "MISSING";
      if (
        verifierStatus !== "VALID" ||
        typeof response?.abiEncodedRequest !== "string" ||
        !/^0x(?:[0-9a-fA-F]{2})+$/.test(response.abiEncodedRequest)
      ) {
        throw createFdcError(
          "schema-invalid",
          "VERIFIER_RESPONSE_INVALID",
          "Verifier did not return VALID hexadecimal request bytes",
          false,
          { verifierStatus },
        );
      }
      return {
        requestBytes: response.abiEncodedRequest,
        attestationType,
        sourceId,
      };
    },
  };
}
