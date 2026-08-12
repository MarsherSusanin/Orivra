import { z } from "zod";
import {
  ApplicationRollbackAuthorizationV1Schema,
  ProductionDeploymentEvidenceV1Schema,
  ProductionPromotionAuthorizationV1Schema,
  ProductionPromotionEvidenceV1Schema,
  ProductionTargetV1Schema,
  canonicalSerializeProductionDeploymentEvidence,
  canonicalSerializeProductionPromotionAuthorization,
  canonicalSerializeProductionPromotionEvidence,
  canonicalSerializeProductionTarget,
  canonicalSerializeApplicationRollbackAuthorization,
  checksumProductionDeploymentEvidence,
  checksumProductionPromotionAuthorization,
  checksumProductionPromotionEvidence,
  checksumProductionTarget,
  checksumApplicationRollbackAuthorization,
} from "./production-promotion-runtime.mjs";

export {
  ApplicationRollbackAuthorizationV1Schema,
  ProductionDeploymentEvidenceV1Schema,
  ProductionPromotionAuthorizationV1Schema,
  ProductionPromotionEvidenceV1Schema,
  ProductionTargetV1Schema,
  canonicalSerializeProductionDeploymentEvidence,
  canonicalSerializeProductionPromotionAuthorization,
  canonicalSerializeProductionPromotionEvidence,
  canonicalSerializeProductionTarget,
  canonicalSerializeApplicationRollbackAuthorization,
  checksumProductionDeploymentEvidence,
  checksumProductionPromotionAuthorization,
  checksumProductionPromotionEvidence,
  checksumProductionTarget,
  checksumApplicationRollbackAuthorization,
};

export type ProductionTargetV1 = z.infer<typeof ProductionTargetV1Schema>;
export type ProductionPromotionAuthorizationV1 = z.infer<typeof ProductionPromotionAuthorizationV1Schema>;
export type ProductionDeploymentEvidenceV1 = z.infer<typeof ProductionDeploymentEvidenceV1Schema>;
export type ProductionPromotionEvidenceV1 = z.infer<typeof ProductionPromotionEvidenceV1Schema>;
export type ApplicationRollbackAuthorizationV1 = z.infer<typeof ApplicationRollbackAuthorizationV1Schema>;
