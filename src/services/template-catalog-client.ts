import {
  Web2JsonTemplateCatalogV1Schema,
  type Web2JsonTemplateCatalogV1,
  type Web2JsonTemplateDetailV1,
} from "@proofline/contracts/templates";
import { resolveWeb2JsonTemplate } from "@proofline/domain/templates";

const TEMPLATE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class TemplateUnavailableError extends Error {
  readonly code = "TEMPLATE_UNAVAILABLE";

  constructor() {
    super("Template unavailable");
    this.name = "TemplateUnavailableError";
  }
}

function unavailable(): TemplateUnavailableError {
  return new TemplateUnavailableError();
}

function apiUrl(pathname: string): URL {
  const origin = globalThis.location?.origin ?? "http://localhost";
  return new URL(`/api${pathname}`, origin);
}

export function createTemplateCatalogClient(input: {
  fetch: typeof globalThis.fetch;
}) {
  const request = async (pathname: string): Promise<unknown> => {
    try {
      const response = await Reflect.apply(input.fetch, globalThis, [
        apiUrl(pathname),
        { method: "GET", credentials: "omit" } satisfies RequestInit,
      ]) as Response;
      if (!response.ok) throw unavailable();
      return await response.json() as unknown;
    } catch {
      throw unavailable();
    }
  };

  const listTemplates = async (): Promise<Web2JsonTemplateCatalogV1> => {
    try {
      return Web2JsonTemplateCatalogV1Schema.parse(
        await request("/v1/templates"),
      );
    } catch {
      throw unavailable();
    }
  };

  return {
    listTemplates,

    async getTemplate(inputValue: {
      id: string;
      revision: number;
    }): Promise<Web2JsonTemplateDetailV1> {
      if (
        inputValue.id.length < 1 ||
        inputValue.id.length > 64 ||
        !TEMPLATE_ID_PATTERN.test(inputValue.id) ||
        !Number.isSafeInteger(inputValue.revision) ||
        inputValue.revision <= 0
      ) {
        throw unavailable();
      }
      try {
        const catalog = await listTemplates();
        const summary = catalog.templates.find(
          ({ id }) => id === inputValue.id,
        );
        if (
          !summary ||
          summary.revision !== inputValue.revision ||
          summary.detailPath !== `/v1/templates/${inputValue.id}`
        ) {
          throw unavailable();
        }
        return resolveWeb2JsonTemplate({
          detail: await request(summary.detailPath),
          expectedId: inputValue.id,
          expectedRevision: inputValue.revision,
        });
      } catch {
        throw unavailable();
      }
    },
  };
}

export type TemplateCatalogClient = ReturnType<
  typeof createTemplateCatalogClient
>;
