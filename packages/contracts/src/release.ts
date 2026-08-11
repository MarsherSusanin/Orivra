import { z } from "zod";
import {
  FrozenOciReleaseManifestV1Schema,
  FrozenOciReleaseReceiptV1Schema,
  canonicalSerializeFrozenOciReleaseManifest,
  canonicalSerializeFrozenOciReleaseReceipt,
  checksumFrozenOciReleaseManifest,
  checksumReleaseArtifactInventory,
} from "./release-runtime.mjs";

export {
  FrozenOciReleaseManifestV1Schema,
  FrozenOciReleaseReceiptV1Schema,
  canonicalSerializeFrozenOciReleaseManifest,
  canonicalSerializeFrozenOciReleaseReceipt,
  checksumFrozenOciReleaseManifest,
  checksumReleaseArtifactInventory,
};

export type FrozenOciReleaseManifestV1 = z.infer<typeof FrozenOciReleaseManifestV1Schema>;
export type FrozenOciReleaseReceiptV1 = z.infer<typeof FrozenOciReleaseReceiptV1Schema>;
