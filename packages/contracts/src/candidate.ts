import { z } from "zod";
import {
  CredentialFreeMlpCandidateV1Schema,
  canonicalSerializeCredentialFreeMlpCandidate,
  checksumCredentialFreeMlpCandidate,
  credentialFreeCandidateGateIds,
} from "./candidate-runtime.mjs";

export {
  CredentialFreeMlpCandidateV1Schema,
  canonicalSerializeCredentialFreeMlpCandidate,
  checksumCredentialFreeMlpCandidate,
  credentialFreeCandidateGateIds,
};

export type CredentialFreeMlpCandidateV1 = z.infer<
  typeof CredentialFreeMlpCandidateV1Schema
>;
