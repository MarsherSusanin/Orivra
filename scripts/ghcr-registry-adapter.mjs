import { Buffer } from "node:buffer";

const OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024;

function fail(message = "GHCR registry operation failed") {
  throw Object.assign(new Error(message), { code: "GHCR_REGISTRY_FAILED" });
}

function repositoryPath(remoteRepository) {
  if (typeof remoteRepository !== "string" || !remoteRepository.startsWith("ghcr.io/") ||
    remoteRepository.includes("@") || remoteRepository.slice(8).includes(":")) fail();
  const path = remoteRepository.slice("ghcr.io/".length);
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(path)) fail();
  return path;
}

function requireSameRegistryLocation(value) {
  const url = new URL(value, "https://ghcr.io");
  if (url.protocol !== "https:" || url.hostname !== "ghcr.io" || url.port !== "" || url.username || url.password || url.hash) fail();
  return url;
}

function requireUploadLocation(value, remoteRepository) {
  const url = requireSameRegistryLocation(value);
  const path = repositoryPath(remoteRepository);
  const prefix = [
    `/v2/${path}/blobs/uploads/`,
    `/v2/${path}/blobs/upload/`,
  ].find((candidate) => url.pathname.startsWith(candidate));
  if (!prefix) fail();
  const opaqueId = url.pathname.slice(prefix.length);
  if (opaqueId.length === 0 || opaqueId.includes("/")) fail();
  return url;
}

async function requireResponse(response, accepted) {
  if (!response || !accepted.includes(response.status)) fail();
  return response;
}

function requireChunkMinimum(value) {
  if (value === null) return;
  if (!/^[1-9][0-9]*$/.test(value)) fail();
  const minimum = Number(value);
  if (!Number.isSafeInteger(minimum) || minimum > UPLOAD_CHUNK_SIZE) fail();
}

function requireAcceptedRange(value, acceptedEnd) {
  if (value !== `0-${acceptedEnd}`) fail();
}

export async function createGhcrRegistryPublicationAdapter({ username, tokenBytes, request = fetch } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(username ?? "") ||
    !(tokenBytes instanceof Uint8Array) || tokenBytes.byteLength < 20 || tokenBytes.byteLength > 4096 ||
    typeof request !== "function") fail("GHCR registry credential is invalid");
  const tokenText = new TextDecoder("utf-8", { fatal: true }).decode(tokenBytes);
  if (/\s|\0/.test(tokenText)) fail("GHCR registry credential is invalid");
  const bearerTokens = new Map();

  async function bearer(remoteRepository) {
    const path = repositoryPath(remoteRepository);
    if (bearerTokens.has(path)) return bearerTokens.get(path);
    const endpoint = new URL("https://ghcr.io/token");
    endpoint.searchParams.set("service", "ghcr.io");
    endpoint.searchParams.set("scope", `repository:${path}:pull,push`);
    const response = await requireResponse(await request(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Basic ${Buffer.from(`${username}:${tokenText}`, "utf8").toString("base64")}`,
      },
      redirect: "error",
    }), [200]);
    const payload = await response.json().catch(() => fail());
    const token = payload?.token ?? payload?.access_token;
    if (typeof token !== "string" || token.length < 20 || /\s|\0/.test(token)) fail();
    bearerTokens.set(path, token);
    return token;
  }

  async function registryRequest(remoteRepository, suffix, options = {}, accepted = [200]) {
    const path = repositoryPath(remoteRepository);
    const token = await bearer(remoteRepository);
    const url = requireSameRegistryLocation(`https://ghcr.io/v2/${path}/${suffix}`);
    return requireResponse(await request(url, {
      ...options,
      headers: {
        ...(options.headers ?? {}),
        authorization: `Bearer ${token}`,
      },
      redirect: "error",
    }), accepted);
  }

  async function ensureBlob(remoteRepository, digest, bytes) {
    if (!SHA256.test(digest) || !(bytes instanceof Uint8Array)) fail();
    const head = await registryRequest(remoteRepository, `blobs/${digest}`, { method: "HEAD" }, [200, 404]);
    if (head.status === 200) return;
    const started = await registryRequest(remoteRepository, "blobs/uploads/", {
      method: "POST",
      headers: { "content-length": "0" },
      body: new Uint8Array(0),
    }, [202]);
    const location = started.headers.get("location");
    if (!location) fail();
    requireChunkMinimum(started.headers.get("oci-chunk-min-length"));
    let upload = requireUploadLocation(location, remoteRepository);
    const seenUploads = new Set([upload.href]);
    const token = await bearer(remoteRepository);
    for (let start = 0; start < bytes.byteLength; start += UPLOAD_CHUNK_SIZE) {
      const end = Math.min(start + UPLOAD_CHUNK_SIZE, bytes.byteLength) - 1;
      const chunk = bytes.subarray(start, end + 1);
      const patched = await requireResponse(await request(upload, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-length": String(chunk.byteLength),
          "content-range": `${start}-${end}`,
          "content-type": "application/octet-stream",
        },
        body: chunk,
        redirect: "error",
      }), [202]);
      const nextLocation = patched.headers.get("location");
      if (!nextLocation) fail();
      const nextUpload = requireUploadLocation(nextLocation, remoteRepository);
      if (seenUploads.has(nextUpload.href)) fail();
      requireAcceptedRange(patched.headers.get("range"), end);
      seenUploads.add(nextUpload.href);
      upload = nextUpload;
    }
    upload.searchParams.set("digest", digest);
    const completed = await requireResponse(await request(upload, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-length": "0",
      },
      body: new Uint8Array(0),
      redirect: "error",
    }), [201]);
    const remoteDigest = completed.headers.get("docker-content-digest");
    if (remoteDigest !== null && remoteDigest !== digest) fail();
  }

  return Object.freeze({
    async copyVerifiedImage({ image, inspected, remoteRepository }) {
      if (image?.imageManifestDigest !== inspected?.imageManifestDigest || !Array.isArray(inspected?.blobs)) fail();
      const manifestBlob = inspected.blobs.find(({ digest }) => digest === image.imageManifestDigest);
      if (!manifestBlob) fail();
      for (const blob of inspected.blobs) {
        if (blob.digest !== image.imageManifestDigest) {
          const bytes = blob.bytes ?? await inspected.readBlob?.(blob.digest);
          await ensureBlob(remoteRepository, blob.digest, bytes);
        }
      }
      const manifestBytes = manifestBlob.bytes ?? await inspected.readBlob?.(manifestBlob.digest);
      if (!(manifestBytes instanceof Uint8Array)) fail();
      const response = await registryRequest(
        remoteRepository,
        `manifests/${image.imageManifestDigest}`,
        {
          method: "PUT",
          headers: {
            "content-length": String(manifestBytes.byteLength),
            "content-type": OCI_MANIFEST,
          },
          body: manifestBytes,
        },
        [201],
      );
      if (response.headers.get("docker-content-digest") !== image.imageManifestDigest) fail();
    },
    async inspectRemoteDigest({ image, remoteRepository }) {
      const response = await registryRequest(remoteRepository, `manifests/${image.imageManifestDigest}`, {
        method: "HEAD",
        headers: { accept: OCI_MANIFEST },
      }, [200]);
      const digest = response.headers.get("docker-content-digest");
      if (!SHA256.test(digest ?? "")) fail();
      return digest;
    },
    dispose() {
      bearerTokens.clear();
      tokenBytes.fill(0);
    },
  });
}
