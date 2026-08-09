// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Slice 023C2B1 provider loading boundary", () => {
  it("keeps the session context provider-free and loads the adapter only from the explicit dialog action", () => {
    const context = readFileSync("src/wallet-session-context.tsx", "utf8");
    const dialog = readFileSync("src/components/WalletSignInDialog.tsx", "utf8");

    expect(context).not.toContain("wallet-provider-adapter");
    expect(context).not.toMatch(/eip6963:|eth_requestAccounts|personal_sign/);
    expect(dialog).toMatch(/import\(["']\.\.\/services\/wallet-provider-adapter["']\)/);
    expect(dialog).not.toMatch(/^import\s+\{[^}]*\}\s+from\s+["']\.\.\/services\/wallet-provider-adapter["']/m);
    expect(dialog).toContain("Sign in with wallet");
  });
});
