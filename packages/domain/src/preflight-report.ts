import {
  PreflightReportV1Schema,
  RedactedJsonShapeV1Schema,
  type PreflightReportV1,
  type RedactedJsonShapeNodeV1,
  type RedactedJsonShapeV1,
} from "@proofline/contracts";
import { canonicalJson } from "./canonical-json";
import { sha256Hex } from "./sha256";

const MAX_SHAPE_NODES = 256;

function jsonValueType(value: unknown): RedactedJsonShapeNodeV1["type"] {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  throw new TypeError(`Unsupported JSON shape value: ${typeof value}`);
}

function escapeJsonPointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function fingerprintCanonicalJson(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

export function createRedactedJsonShape(value: unknown): RedactedJsonShapeV1 {
  const nodes: RedactedJsonShapeNodeV1[] = [];
  let truncated = false;

  const visit = (item: unknown, path: string): void => {
    if (nodes.length === MAX_SHAPE_NODES) {
      truncated = true;
      return;
    }

    const type = jsonValueType(item);
    nodes.push({ path, type });
    if (type === "array") {
      const values = item as unknown[];
      for (let index = 0; index < values.length && !truncated; index += 1) {
        visit(values[index], `${path}/${index}`);
      }
    } else if (type === "object") {
      for (const key of Object.keys(item as Record<string, unknown>).sort()) {
        visit(
          (item as Record<string, unknown>)[key],
          `${path}/${escapeJsonPointerSegment(key)}`,
        );
        if (truncated) break;
      }
    }
  };

  visit(value, "");
  const nodesByPath = new Map(nodes.map((node) => [node.path, node.type]));
  const orderedNodes = [...nodesByPath.keys()].sort().map((path) => ({
    path,
    type: nodesByPath.get(path)!,
  }));
  return RedactedJsonShapeV1Schema.parse({ truncated, nodes: orderedNodes });
}

export function canonicalSerializePreflightReport(value: unknown): string {
  const report: PreflightReportV1 = PreflightReportV1Schema.parse(value);
  return canonicalJson(report);
}
