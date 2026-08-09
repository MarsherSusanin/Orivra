export const ABI_SIGNATURE_MAX_CHARACTERS = 2_048;

export function isValidWeb2JsonAbiSignature(
  value: string,
  schema: { safeParse(candidate: unknown): { success: boolean } },
): boolean {
  if (value.length > ABI_SIGNATURE_MAX_CHARACTERS) return false;
  try {
    return schema.safeParse(JSON.parse(value)).success;
  } catch {
    return false;
  }
}

export function isSafePublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.port === "" || url.port === "443") &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}
