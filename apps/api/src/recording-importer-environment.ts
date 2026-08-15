export function isolateRecordingImporterEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
) {
  const dedicatedFile =
    environment.PROOFLINE_RECORDING_IMPORTER_DATABASE_URL_FILE;
  if (dedicatedFile !== undefined) {
    return Object.freeze({ DATABASE_URL_FILE: dedicatedFile });
  }
  return Object.freeze({
    DATABASE_URL: environment.DATABASE_URL,
    DATABASE_URL_FILE: environment.DATABASE_URL_FILE,
  });
}
