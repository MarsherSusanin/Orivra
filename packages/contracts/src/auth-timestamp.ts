import { z } from "zod";

const CanonicalAuthTimestampV1Pattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isCanonicalAuthTimestampV1(value: string): boolean {
  if (!CanonicalAuthTimestampV1Pattern.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export const AuthTimestampV1Schema = z
  .string()
  .refine(
    isCanonicalAuthTimestampV1,
    "Expected a valid canonical millisecond-UTC timestamp.",
  );
