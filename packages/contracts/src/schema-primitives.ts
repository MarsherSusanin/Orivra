import { z } from "zod";

export const VersionV1Schema = z.literal("1");

export const UINT256_MAX_DECIMAL =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

export function isCanonicalUint256Decimal(value: string): boolean {
  return (
    /^(?:0|[1-9]\d*)$/.test(value) &&
    (value.length < UINT256_MAX_DECIMAL.length ||
      (value.length === UINT256_MAX_DECIMAL.length &&
        value <= UINT256_MAX_DECIMAL))
  );
}

export const CanonicalUint256DecimalSchema = z
  .string()
  .refine(
    isCanonicalUint256Decimal,
    "Expected a canonical uint256 decimal string",
  );

export const FdcNetworkV1Schema = z.enum(["coston2", "flare"]);
export type FdcNetworkV1 = z.infer<typeof FdcNetworkV1Schema>;
