const SHA256 = /^sha256:[a-f0-9]{64}$/;
const expectedServices = Object.freeze(["api", "caddy", "postgres", "web"]);

function invalid() {
  throw Object.assign(new Error("Recorded product observation is invalid"), {
    code: "MLP_RECORDED_PRODUCT_INVALID",
  });
}

export async function createRecordedProductFixture() {
  return Buffer.from(JSON.stringify({
    version: "1",
    kind: "recorded-product-fixture",
    landing: {
      documentTitle: "Orivra · Web2Json evidence",
      route: "/",
    },
    template: {
      apiCatalogPath: "/api/v1/templates",
      apiDetailPath: "/api/v1/templates/open-meteo-current-weather",
      id: "open-meteo-current-weather",
      productPath: "/templates/open-meteo-current-weather",
    },
    replay: {
      gate: "test:e2e",
      network: "coston2",
      submissionMode: "replay",
    },
  }), "utf8");
}

export function createRecordedProductObservation({ fixtureSha256 } = {}) {
  if (!SHA256.test(fixtureSha256 ?? "")) invalid();
  return Object.freeze({
    fixtureFilename: "recorded-product-fixture.v1.json",
    fixtureSha256,
    mode: "checked-in-recorded-fixture",
    publicOrigin: "https://127.0.0.1",
    worker: "stopped",
    status: "passed",
  });
}

export function verifyRecordedProductObservation({
  services = expectedServices,
  origin = "https://127.0.0.1",
  fixtureSha256,
} = {}) {
  if (
    origin !== "https://127.0.0.1" ||
    !SHA256.test(fixtureSha256 ?? "") ||
    !Array.isArray(services) ||
    JSON.stringify([...services].sort()) !== JSON.stringify(expectedServices)
  ) invalid();
  return true;
}
