import { z } from "zod";
import {
  GhcrPublicationTargetsV1Schema,
  PublicationEvidenceV1Schema,
  StagingDeploymentEvidenceV1Schema,
  canonicalSerializeGhcrPublicationTargets,
  canonicalSerializePublicationEvidence,
  canonicalSerializeStagingDeploymentEvidence,
  checksumGhcrPublicationTargets,
  checksumPublicationEvidence,
  checksumStagingDeploymentEvidence,
} from "./publication-runtime.mjs";

export {
  GhcrPublicationTargetsV1Schema,
  PublicationEvidenceV1Schema,
  StagingDeploymentEvidenceV1Schema,
  canonicalSerializeGhcrPublicationTargets,
  canonicalSerializePublicationEvidence,
  canonicalSerializeStagingDeploymentEvidence,
  checksumGhcrPublicationTargets,
  checksumPublicationEvidence,
  checksumStagingDeploymentEvidence,
};

export type GhcrPublicationTargetsV1 = z.infer<typeof GhcrPublicationTargetsV1Schema>;
export type PublicationEvidenceV1 = z.infer<typeof PublicationEvidenceV1Schema>;
export type StagingDeploymentEvidenceV1 = z.infer<typeof StagingDeploymentEvidenceV1Schema>;
