import { z } from "zod";
import {
  ApplicationRollbackAuthorizationV1Schema,
  ApplicationRollbackAuthorizationV2Schema,
  ProductionCanaryCheckpointV2Schema,
  ProductionDeploymentEvidenceV1Schema,
  ProductionDeploymentEvidenceV2Schema,
  ProductionPilotPreflightEvidenceV1Schema,
  ProductionPilotPreflightEvidenceV2Schema,
  ProductionPromotionAuthorizationV1Schema,
  ProductionPromotionAuthorizationV2Schema,
  ProductionPromotionEvidenceV1Schema,
  ProductionPromotionEvidenceV2Schema,
  ProductionTargetV1Schema,
  ProductionTargetV2Schema,
  SafeConsumerDeploymentEvidenceV1Schema,
  SafeConsumerRegistryV1Schema,
  TimewebS3PilotAuthorityV1Schema,
  canonicalSerializeApplicationRollbackAuthorizationV2,
  canonicalSerializeProductionCanaryCheckpointV2,
  canonicalSerializeProductionDeploymentEvidence,
  canonicalSerializeProductionDeploymentEvidenceV2,
  canonicalSerializeProductionPilotPreflightEvidence,
  canonicalSerializeProductionPilotPreflightEvidenceV2,
  canonicalSerializeProductionPromotionAuthorization,
  canonicalSerializeProductionPromotionAuthorizationV2,
  canonicalSerializeProductionPromotionEvidence,
  canonicalSerializeProductionPromotionEvidenceV2,
  canonicalSerializeProductionTarget,
  canonicalSerializeProductionTargetV2,
  canonicalSerializeApplicationRollbackAuthorization,
  canonicalSerializeSafeConsumerRegistry,
  canonicalSerializeSafeConsumerDeploymentEvidence,
  canonicalSerializeTimewebS3PilotAuthority,
  checksumApplicationRollbackAuthorizationV2,
  checksumProductionCanaryCheckpointV2,
  checksumProductionDeploymentEvidence,
  checksumProductionDeploymentEvidenceV2,
  checksumProductionPilotPreflightEvidence,
  checksumProductionPilotPreflightEvidenceV2,
  checksumProductionPromotionAuthorization,
  checksumProductionPromotionAuthorizationV2,
  checksumProductionPromotionEvidence,
  checksumProductionPromotionEvidenceV2,
  checksumProductionTarget,
  checksumProductionTargetV2,
  checksumApplicationRollbackAuthorization,
  checksumSafeConsumerRegistry,
  checksumSafeConsumerDeploymentEvidence,
  checksumTimewebS3PilotAuthority,
} from "./production-promotion-runtime.mjs";

export {
  ApplicationRollbackAuthorizationV1Schema,
  ApplicationRollbackAuthorizationV2Schema,
  ProductionCanaryCheckpointV2Schema,
  ProductionDeploymentEvidenceV1Schema,
  ProductionDeploymentEvidenceV2Schema,
  ProductionPilotPreflightEvidenceV1Schema,
  ProductionPilotPreflightEvidenceV2Schema,
  ProductionPromotionAuthorizationV1Schema,
  ProductionPromotionAuthorizationV2Schema,
  ProductionPromotionEvidenceV1Schema,
  ProductionPromotionEvidenceV2Schema,
  ProductionTargetV1Schema,
  ProductionTargetV2Schema,
  SafeConsumerDeploymentEvidenceV1Schema,
  SafeConsumerRegistryV1Schema,
  TimewebS3PilotAuthorityV1Schema,
  canonicalSerializeApplicationRollbackAuthorizationV2,
  canonicalSerializeProductionCanaryCheckpointV2,
  canonicalSerializeProductionDeploymentEvidence,
  canonicalSerializeProductionDeploymentEvidenceV2,
  canonicalSerializeProductionPilotPreflightEvidence,
  canonicalSerializeProductionPilotPreflightEvidenceV2,
  canonicalSerializeProductionPromotionAuthorization,
  canonicalSerializeProductionPromotionAuthorizationV2,
  canonicalSerializeProductionPromotionEvidence,
  canonicalSerializeProductionPromotionEvidenceV2,
  canonicalSerializeProductionTarget,
  canonicalSerializeProductionTargetV2,
  canonicalSerializeApplicationRollbackAuthorization,
  canonicalSerializeSafeConsumerRegistry,
  canonicalSerializeSafeConsumerDeploymentEvidence,
  canonicalSerializeTimewebS3PilotAuthority,
  checksumApplicationRollbackAuthorizationV2,
  checksumProductionCanaryCheckpointV2,
  checksumProductionDeploymentEvidence,
  checksumProductionDeploymentEvidenceV2,
  checksumProductionPilotPreflightEvidence,
  checksumProductionPilotPreflightEvidenceV2,
  checksumProductionPromotionAuthorization,
  checksumProductionPromotionAuthorizationV2,
  checksumProductionPromotionEvidence,
  checksumProductionPromotionEvidenceV2,
  checksumProductionTarget,
  checksumProductionTargetV2,
  checksumApplicationRollbackAuthorization,
  checksumSafeConsumerRegistry,
  checksumSafeConsumerDeploymentEvidence,
  checksumTimewebS3PilotAuthority,
};

export type ProductionTargetV1 = z.infer<typeof ProductionTargetV1Schema>;
export type ProductionPromotionAuthorizationV1 = z.infer<typeof ProductionPromotionAuthorizationV1Schema>;
export type ProductionDeploymentEvidenceV1 = z.infer<typeof ProductionDeploymentEvidenceV1Schema>;
export type ProductionPromotionEvidenceV1 = z.infer<typeof ProductionPromotionEvidenceV1Schema>;
export type ApplicationRollbackAuthorizationV1 = z.infer<typeof ApplicationRollbackAuthorizationV1Schema>;
export type TimewebS3PilotAuthorityV1 = z.infer<typeof TimewebS3PilotAuthorityV1Schema>;
export type SafeConsumerRegistryV1 = z.infer<typeof SafeConsumerRegistryV1Schema>;
export type SafeConsumerDeploymentEvidenceV1 = z.infer<typeof SafeConsumerDeploymentEvidenceV1Schema>;
export type ProductionPilotPreflightEvidenceV1 = z.infer<typeof ProductionPilotPreflightEvidenceV1Schema>;
export type ProductionPilotPreflightEvidenceV2 = z.infer<typeof ProductionPilotPreflightEvidenceV2Schema>;
export type ProductionTargetV2 = z.infer<typeof ProductionTargetV2Schema>;
export type ProductionPromotionAuthorizationV2 = z.infer<typeof ProductionPromotionAuthorizationV2Schema>;
export type ProductionDeploymentEvidenceV2 = z.infer<typeof ProductionDeploymentEvidenceV2Schema>;
export type ProductionCanaryCheckpointV2 = z.infer<typeof ProductionCanaryCheckpointV2Schema>;
export type ProductionPromotionEvidenceV2 = z.infer<typeof ProductionPromotionEvidenceV2Schema>;
export type ApplicationRollbackAuthorizationV2 = z.infer<typeof ApplicationRollbackAuthorizationV2Schema>;
