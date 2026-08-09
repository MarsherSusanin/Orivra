import type { AccountV1, WalletSessionV1 } from "@proofline/contracts";
import { vi } from "vitest";
import type { AppProps } from "../App";
import type { WalletAccessServices } from "../services/wallet-access-client";
import type { StorageLike } from "../services/wallet-session-controller";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

export function createProjectWalletAccessFixture(
  projectToken: string,
  storage: StorageLike = sessionStorage,
) {
  const account: AccountV1 = {
    version: "1",
    wallet: { kind: "eoa", address: ADDRESS },
    project: { kind: "default", projectId: PROJECT_ID },
    tokens: [],
  };
  const session: WalletSessionV1 = {
    version: "1",
    wallet: account.wallet,
    project: account.project,
    projectToken,
    issuedAt: "2026-08-09T00:00:00.000Z",
    expiresAt: "2026-08-09T12:00:00.000Z",
  };
  const getAccount = vi.fn(async () => account);
  const services: WalletAccessServices = {
    listNetworks: vi.fn(),
    createWalletChallenge: vi.fn(),
    createWalletSession: vi.fn(async () => session),
    getAccount,
    createAccountToken: vi.fn(),
    revokeAccountToken: vi.fn(),
    revokeCurrentSession: vi.fn(async () => undefined),
  };
  const walletAccess: NonNullable<AppProps["walletAccess"]> = {
    services,
    storage,
  };
  return { account, getAccount, services, walletAccess };
}
