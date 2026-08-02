// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  PreflightReportV1Schema,
  ProofBundleV1Schema,
  RunEventV1Schema,
  Web2JsonManifestV1Schema,
} from "../src/index";
import {
  makeBundleInput,
  makeRunEvents,
  UINT256_MAX,
  UINT256_OVERFLOW,
  validManifest,
  validPreflightReport,
} from "./fixtures";

describe("Slice 016 final public integer and credential boundaries", () => {
  it.each(["sig", "AWSAccessKeyId"])(
    "rejects credential-bearing manifest query name %s in both query inputs",
    (name) => {
      const requestQueryCandidate = {
        ...validManifest,
        request: {
          ...validManifest.request,
          query: { ...validManifest.request.query, [name]: "public-looking" },
        },
      };
      const urlQueryCandidate = {
        ...validManifest,
        request: {
          ...validManifest.request,
          url: `https://api.example.com/prices/eth?${encodeURIComponent(name)}=public-looking`,
        },
      };
      expect(Web2JsonManifestV1Schema.safeParse(requestQueryCandidate).success).toBe(false);
      expect(Web2JsonManifestV1Schema.safeParse(urlQueryCandidate).success).toBe(false);
    },
  );

  it("does not overmatch the ordinary signatureVersion query name", () => {
    const candidate = {
      ...validManifest,
      request: {
        ...validManifest.request,
        query: { ...validManifest.request.query, signatureVersion: "4" },
      },
    };
    expect(Web2JsonManifestV1Schema.safeParse(candidate).success).toBe(true);
    expect(
      Web2JsonManifestV1Schema.safeParse({
        ...candidate,
        request: {
          ...candidate.request,
          url: "https://api.example.com/prices/eth?signatureVersion=4",
        },
      }).success,
    ).toBe(true);
  });

  it("accepts uint256 max and rejects 2^256 for every public wei/block boundary", () => {
    const manifestAtMax = {
      ...validManifest,
      submission: { ...validManifest.submission, feeCapWei: UINT256_MAX },
    };
    expect(Web2JsonManifestV1Schema.safeParse(manifestAtMax).success).toBe(true);
    expect(
      Web2JsonManifestV1Schema.safeParse({
        ...manifestAtMax,
        submission: { ...manifestAtMax.submission, feeCapWei: UINT256_OVERFLOW },
      }).success,
    ).toBe(false);

    for (const field of ["quotedWei", "capWei"] as const) {
      expect(
        PreflightReportV1Schema.safeParse({
          ...structuredClone(validPreflightReport),
          fee: {
            quotedWei: UINT256_MAX,
            capWei: UINT256_MAX,
            withinCap: true,
          },
        }).success,
      ).toBe(true);
      expect(
        PreflightReportV1Schema.safeParse({
          ...structuredClone(validPreflightReport),
          fee: {
            ...structuredClone(validPreflightReport.fee),
            [field]: UINT256_OVERFLOW,
            withinCap: field === "quotedWei" ? false : true,
          },
        }).success,
      ).toBe(false);
    }

    expect(
      PreflightReportV1Schema.safeParse({
        ...structuredClone(validPreflightReport),
        registrySnapshot: {
          ...structuredClone(validPreflightReport.registrySnapshot),
          blockNumber: UINT256_MAX,
        },
      }).success,
    ).toBe(true);
    expect(
      PreflightReportV1Schema.safeParse({
        ...structuredClone(validPreflightReport),
        registrySnapshot: {
          ...structuredClone(validPreflightReport.registrySnapshot),
          blockNumber: UINT256_OVERFLOW,
        },
      }).success,
    ).toBe(false);

    const accepted = makeRunEvents()[1];
    expect(
      RunEventV1Schema.safeParse({
        ...accepted,
        payload: { ...accepted.payload, quotedFeeWei: UINT256_MAX },
      }).success,
    ).toBe(true);
    expect(
      RunEventV1Schema.safeParse({
        ...accepted,
        payload: { ...accepted.payload, quotedFeeWei: UINT256_OVERFLOW },
      }).success,
    ).toBe(false);
  });
});

describe("Slice 016 final ProofBundle network evidence", () => {
  it("requires the registry block and fee-configuration contract", () => {
    const bundle = {
      ...makeBundleInput(),
      checksum: `sha256:${"a".repeat(64)}`,
    };
    expect(ProofBundleV1Schema.safeParse(bundle).success).toBe(true);

    const withoutBlock = structuredClone(bundle) as any;
    delete withoutBlock.network.blockNumber;
    expect(ProofBundleV1Schema.safeParse(withoutBlock).success).toBe(false);

    const withoutFeeConfiguration = structuredClone(bundle) as any;
    delete withoutFeeConfiguration.network.resolvedContracts
      .FdcRequestFeeConfigurations;
    expect(ProofBundleV1Schema.safeParse(withoutFeeConfiguration).success).toBe(
      false,
    );
  });
});
