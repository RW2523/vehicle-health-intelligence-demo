import { request } from "@playwright/test";

/** Log in once as the presenter; every test starts from that session (playwright.config.ts storageState). */
export const STATE = "e2e/.auth/presenter.json";

export default async function globalSetup() {
  const ctx = await request.newContext({ baseURL: process.env.E2E_BASE_URL || "http://localhost:3000" });
  const r = await ctx.post("/api/auth/login", { data: { username: "presenter", password: process.env.E2E_PASSWORD || "" } });
  if (!r.ok()) throw new Error(`e2e login failed (HTTP ${r.status()}): set E2E_PASSWORD to the API's VHI_DEMO_PASSWORD`);
  await ctx.storageState({ path: STATE });
  await ctx.dispose();
}
