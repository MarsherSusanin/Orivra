const ERROR_CODE = "DEPLOYMENT_SECRET_CONFIGURATION_INVALID";
const ERROR_MESSAGE = "Deployment secret configuration is invalid";

class DeploymentDatabaseAuthorityError extends Error {
  readonly code = ERROR_CODE;

  constructor() {
    super(ERROR_MESSAGE);
    this.name = "DeploymentDatabaseAuthorityError";
  }
}

function invalidAuthority(): never {
  throw new DeploymentDatabaseAuthorityError();
}

export function parseExactApplicationDatabaseUrl(
  value: string,
  expectedLogin: string,
): string {
  try {
    if (value !== value.trim() || expectedLogin.length === 0) invalidAuthority();
    const parsed = new URL(value);
    if (
      parsed.protocol !== "postgres:" ||
      decodeURIComponent(parsed.username) !== expectedLogin ||
      decodeURIComponent(parsed.password).length === 0 ||
      parsed.host !== "postgres:5432" ||
      parsed.pathname !== "/proofline" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      invalidAuthority();
    }
    return value;
  } catch (cause) {
    if (cause instanceof DeploymentDatabaseAuthorityError) throw cause;
    invalidAuthority();
  }
}
