import { z } from "zod";
import { Web2JsonManifestV1Schema } from "./web2json-manifest";
import { VersionV1Schema } from "./schema-primitives";

const TemplateIdV1Schema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const TemplateRevisionV1Schema = z.number().int().positive().safe();
const TemplateManifestSha256V1Schema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/);
const TemplateManifestV1Schema = z.lazy(() => Web2JsonManifestV1Schema);

export const Web2JsonTemplateProvenanceV1Schema = z
  .object({
    kind: z.literal("proofline-builtin"),
    catalogRevision: TemplateRevisionV1Schema,
    templateId: TemplateIdV1Schema,
    templateRevision: TemplateRevisionV1Schema,
    manifestSha256: TemplateManifestSha256V1Schema,
  })
  .strict();

export type Web2JsonTemplateProvenanceV1 = z.infer<
  typeof Web2JsonTemplateProvenanceV1Schema
>;

export const Web2JsonTemplateSummaryV1Schema = z
  .object({
    id: TemplateIdV1Schema,
    revision: TemplateRevisionV1Schema,
    title: z.string().trim().min(1).max(80),
    summary: z.string().trim().min(1).max(240),
    provider: z.string().trim().min(1).max(80),
    category: z.enum(["finance", "reference", "weather"]),
    featured: z.boolean(),
    manifestSha256: TemplateManifestSha256V1Schema,
    detailPath: z.string().max(78),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.detailPath !== `/v1/templates/${value.id}`) {
      context.addIssue({
        code: "custom",
        path: ["detailPath"],
        message: "Template detail path must match its canonical ID",
      });
    }
  });

export type Web2JsonTemplateSummaryV1 = z.infer<
  typeof Web2JsonTemplateSummaryV1Schema
>;

export const Web2JsonTemplateCatalogV1Schema = z
  .object({
    version: VersionV1Schema,
    kind: z.literal("web2json-template-catalog"),
    catalogRevision: TemplateRevisionV1Schema,
    templates: z.array(Web2JsonTemplateSummaryV1Schema).min(1).max(64),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.templates.map(({ id }) => id)).size !== value.templates.length) {
      context.addIssue({
        code: "custom",
        path: ["templates"],
        message: "Template IDs must be unique",
      });
    }
    const featured = value.templates.filter(({ featured }) => featured);
    if (featured.length !== 1 || value.templates[0]?.featured !== true) {
      context.addIssue({
        code: "custom",
        path: ["templates"],
        message: "The catalog must have one featured first template",
      });
    }
    const expectedOrder = [...value.templates].sort((left, right) => {
      if (left.featured !== right.featured) return left.featured ? -1 : 1;
      if (left.id === right.id) return 0;
      return left.id < right.id ? -1 : 1;
    });
    if (expectedOrder.some(({ id }, index) => value.templates[index]?.id !== id)) {
      context.addIssue({
        code: "custom",
        path: ["templates"],
        message: "Templates must be ordered by featured state then canonical ID",
      });
    }
  });

export type Web2JsonTemplateCatalogV1 = z.infer<
  typeof Web2JsonTemplateCatalogV1Schema
>;

export const Web2JsonTemplateDetailV1Schema = z
  .object({
    version: VersionV1Schema,
    kind: z.literal("web2json-template-detail"),
    template: Web2JsonTemplateSummaryV1Schema,
    manifest: TemplateManifestV1Schema,
    manifestCanonicalJson: z.string().min(2).max(65_536),
    provenance: Web2JsonTemplateProvenanceV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.provenance.templateId !== value.template.id ||
      value.provenance.templateRevision !== value.template.revision ||
      value.provenance.manifestSha256 !== value.template.manifestSha256
    ) {
      context.addIssue({
        code: "custom",
        path: ["provenance"],
        message: "Template provenance must match its summary",
      });
    }
  });

export type Web2JsonTemplateDetailV1 = z.infer<
  typeof Web2JsonTemplateDetailV1Schema
>;
