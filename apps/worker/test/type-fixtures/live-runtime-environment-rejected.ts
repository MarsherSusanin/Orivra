import { createLiveCoston2PipelinePorts } from "../../src/live-runtime";
import { testLiveCoston2RuntimeConfig } from "../live-runtime-config.fixture";

const verifier = {
  prepareRequest: async () => ({ requestBytes: "0x" }),
};

createLiveCoston2PipelinePorts({
  runtimeConfig: testLiveCoston2RuntimeConfig(),
  verifier,
});

// @ts-expect-error Environment authority is rejected at the production port.
createLiveCoston2PipelinePorts({ environment: {}, verifier });
