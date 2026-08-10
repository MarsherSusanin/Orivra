function cleanupTargetIsAbsent(cause) {
  return cause?.code === "ENOENT" ||
    /(?:no such (?:container|object)|not found)/i.test(String(cause?.message ?? ""));
}

export async function runQaSmokeLifecycle({
  createTemporaryDirectory,
  prepareTemporaryDirectory,
  runSmoke,
  removeTemporaryDirectory,
}) {
  const temporaryDirectory = await createTemporaryDirectory();
  try {
    const prepared = await prepareTemporaryDirectory(temporaryDirectory);
    return await runSmoke(prepared);
  } finally {
    await removeTemporaryDirectory(temporaryDirectory);
  }
}

export async function assertExactTlsPortAvailable({
  bindExactTlsPort,
  startDockerReservation,
  removeDockerReservation,
}) {
  try {
    await bindExactTlsPort();
    return;
  } catch (cause) {
    if (cause?.code !== "EACCES") throw cause;
  }

  let reservationFailure;
  try {
    await startDockerReservation();
  } catch (cause) {
    reservationFailure = cause;
  }

  try {
    await removeDockerReservation();
  } catch (cause) {
    if (!cleanupTargetIsAbsent(cause) && reservationFailure === undefined) {
      throw cause;
    }
  }

  if (reservationFailure !== undefined) throw reservationFailure;
}
