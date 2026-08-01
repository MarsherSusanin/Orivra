const COMPOSER_JOURNEY_STORAGE_KEY = "proofline:composer-journey:v1";

type ComposerEntryPoint = "runs" | "direct";
type SessionStoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type ComposerJourneyMarkerV1 = {
  version: "1";
  status: "started";
  entryPoint: ComposerEntryPoint;
};

function decodeMarker(value: string | null): ComposerJourneyMarkerV1 | null {
  if (value === null) return null;
  try {
    const candidate = JSON.parse(value) as unknown;
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      return null;
    }
    const record = candidate as Record<string, unknown>;
    if (
      Object.keys(record).length !== 3 ||
      record.version !== "1" ||
      record.status !== "started" ||
      (record.entryPoint !== "runs" && record.entryPoint !== "direct")
    ) {
      return null;
    }
    return {
      version: "1",
      status: "started",
      entryPoint: record.entryPoint,
    };
  } catch {
    return null;
  }
}

function readMarker(storage: SessionStoragePort): ComposerJourneyMarkerV1 | null {
  try {
    const raw = storage.getItem(COMPOSER_JOURNEY_STORAGE_KEY);
    const marker = decodeMarker(raw);
    if (raw !== null && marker === null) storage.removeItem(COMPOSER_JOURNEY_STORAGE_KEY);
    return marker;
  } catch {
    return null;
  }
}

function writeMarker(storage: SessionStoragePort, entryPoint: ComposerEntryPoint): void {
  const marker: ComposerJourneyMarkerV1 = {
    version: "1",
    status: "started",
    entryPoint,
  };
  try {
    storage.setItem(COMPOSER_JOURNEY_STORAGE_KEY, JSON.stringify(marker));
  } catch {
    // Session persistence is optional and never blocks Composer interaction.
  }
}

export function startComposerJourneyFromRuns(storage: SessionStoragePort): void {
  writeMarker(storage, "runs");
}

export function startDirectComposerJourney(storage: SessionStoragePort): boolean {
  if (readMarker(storage) !== null) return false;
  writeMarker(storage, "direct");
  return true;
}

export { COMPOSER_JOURNEY_STORAGE_KEY };
