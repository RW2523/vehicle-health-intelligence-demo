import { APIRequestContext, expect, Page, test } from "@playwright/test";

/** Fast-forward a lane session through the API (the same call the "Fast-forward" button makes). */
async function fastForward(request: APIRequestContext, sid: string) {
  const r = await request.post(`/api/sessions/${sid}/start`, { data: { fast: true }, timeout: 180_000 });
  expect(r.ok(), `${sid} fast start`).toBeTruthy();
  return r.json();
}

async function confirmAll(page: Page) {
  const confirm = page.getByRole("button", { name: "Confirm", exact: true });
  for (let n = await confirm.count(); n > 0; n = await confirm.count()) {
    await confirm.first().click();
    await expect(confirm).toHaveCount(n - 1);
  }
}

test.describe("Demo control", () => {
  test("lists the six sessions and fast-forwards S1 from the UI", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Demo control" })).toBeVisible();
    for (const sid of ["S1", "S2", "S3", "S4", "S5", "S6"]) await expect(page.getByText(sid, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Evidence entries")).toBeVisible();
    await page.getByRole("button", { name: "Fast-forward" }).first().click();
    await expect(page.getByText("S1 completed instantly")).toBeVisible({ timeout: 180_000 });
  });
});

test.describe("S1 lane → examiner → report → public verification", () => {
  test("examiner decides every alert, issues a FAIL report, buyer verifies it", async ({ page, request }) => {
    await fastForward(request, "S1");
    await page.goto("/lane?lane=BR00-L3");
    await expect(page.getByText("DMO 9001").first()).toBeVisible();

    await page.goto("/examiner?session=S1");
    await expect(page.getByRole("heading", { name: "Examiner console" })).toBeVisible();
    await expect(page.getByText("Why this health score")).toBeVisible();
    await expect(page.getByText(/Ranked alerts \(\d+\)/)).toBeVisible();
    await expect(page.getByRole("tab", { name: "S1 · DMO 9001" })).toHaveAttribute("aria-selected", "true");

    // dismissing without a reason is refused
    await page.getByRole("button", { name: "Dismiss", exact: true }).first().click();
    await expect(page.getByText("Add a short reason to dismiss or defer.")).toBeVisible();

    await confirmAll(page);
    await expect(page.getByText(/(\d+) of \1 alerts/)).toBeVisible();
    const issue = page.getByRole("button", { name: "Issue report", exact: true });
    await expect(issue).toBeEnabled();
    await issue.click();
    await expect(page).toHaveURL(/\/report\?id=/);
    await expect(page.getByText("FAIL").first()).toBeVisible();
    await expect(page.getByText("Chain intact")).toBeVisible();

    await page.getByRole("link", { name: "What the buyer sees →" }).click();
    await expect(page).toHaveURL(/\/verify\//);
    await expect(page.getByText("Genuine, unaltered report")).toBeVisible();
  });
});

test.describe("S2 flood + EV and S3 identity", () => {
  test("S2 shows the flood-damage evidence and a health score", async ({ page, request }) => {
    await fastForward(request, "S2");
    await page.goto("/examiner?session=S2");
    await expect(page.getByText("DMO 9002").first()).toBeVisible();
    await expect(page.getByText(/flood/i).first()).toBeVisible();
    await expect(page.getByText("Why this health score")).toBeVisible();
  });

  test("S3 identity mismatch routes the inspection to a senior examiner", async ({ page, request }) => {
    await fastForward(request, "S3");
    await page.goto("/examiner?session=S3");
    await expect(page.getByText(/only a senior examiner can sign this off/)).toBeVisible();
    await page.getByRole("button", { name: "Route to senior examiner" }).click();
    await expect(page.getByRole("combobox", { name: "Examiner" })).toHaveValue("VE001");
  });
});

test.describe("S4 HQ", () => {
  test("flags the two examiners, the worst lane device and detects a tampered record", async ({ page }) => {
    await page.goto("/hq");
    await expect(page.getByRole("heading", { name: "HQ operations" })).toBeVisible();
    await expect(page.getByText("VE017, VE044")).toBeVisible();
    await expect(page.getByText("All records intact")).toBeVisible();
    await page.getByRole("button", { name: "Run tamper test" }).click();
    await expect(page.getByText(/Tamper detected at entry #\d+; record restored/)).toBeVisible();
    await expect(page.getByText(/restored → intact again/)).toBeVisible();
  });
});

test.describe("S5 fleet + regulator", () => {
  test("fleet overview → vehicle history → pattern report and booking", async ({ page }) => {
    await page.goto("/fleet");
    await expect(page.getByRole("heading", { name: "Fleet Intelligence" })).toBeVisible();
    await expect(page.getByText("Vehicles needing attention")).toBeVisible();
    await page.getByRole("button", { name: "With photos" }).click();
    await expect(page.getByText("VKR 3128")).toBeVisible();

    await page.goto("/fleet/vehicle/VKR%203128");
    await expect(page.getByText("VKR 3128").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pattern report" })).toBeVisible();
    await page.getByRole("button", { name: /Send report now|send again/ }).click();
    await expect(page.getByRole("button", { name: /Report sent ✓/ })).toBeVisible();
    const book = page.getByRole("button", { name: "Book inspection" });
    if ((await book.count()) > 0) await book.click(); // already booked on a re-run
    await expect(page.getByRole("button", { name: /^Booked / })).toBeVisible();
  });

  test("FLEET07 shows the next-Berkala fail risk", async ({ page }) => {
    await page.goto("/fleet?fleet=FLEET07");
    await expect(page.getByText(/FLEET07 · next Berkala fail risk/)).toBeVisible();
  });

  test("regulator view shows real registrations and synthetic defect trends", async ({ page }) => {
    await page.goto("/regulator");
    await expect(page.getByText("1,629,552")).toBeVisible();
    await expect(page.getByText("Inspection fail rate and top defects")).toBeVisible();
    await expect(page.getByText("High-emitter hits (latest)")).toBeVisible();
  });
});

test.describe("S6 owner app", () => {
  test("assistant answers in BM and offers GEAR slots", async ({ page }) => {
    await page.goto("/owner?plate=DMO%209006&tab=chat");
    await page.getByLabel("Message").fill("Saya nak jual kereta, pemeriksaan apa yang saya perlu?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/B5/).last()).toBeVisible();
    await page.getByLabel("Message").fill("Ada slot esok di Glenmarie?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/GEAR/).last()).toBeVisible();
  });

  test("self-check fails first, passes after fixing", async ({ page }) => {
    await page.goto("/owner?plate=DMO%209006&tab=check");
    await page.getByRole("button", { name: "Run self-check" }).click();
    await expect(page.getByText("Fix these first")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Window tint").first()).toBeVisible();
    await page.getByRole("button", { name: "After fixing (S6 attempt 2)" }).click();
    await expect(page.getByText("Likely to pass")).toBeVisible({ timeout: 60_000 });
  });

  test("books and pays for an inspection, gets a check-in QR", async ({ page }) => {
    await page.goto("/owner?plate=DMO%209006&tab=book");
    const slot = page.locator("div.grid-cols-4 button:enabled").first();
    await expect(slot).toBeVisible();
    await slot.click();
    await page.getByRole("button", { name: /^Pay RM/ }).click();
    await expect(page.getByText("Booking confirmed")).toBeVisible();
    await expect(page.getByAltText("Check-in QR code")).toBeVisible();
  });
});

test.describe("AI vision", () => {
  test("runs the live damage model on a curated capture", async ({ page }) => {
    await page.goto("/vision");
    await expect(page.getByRole("heading", { name: "AI vision inspection" })).toBeVisible();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByText(/onnx|YOLO|confidence|%/i).first()).toBeVisible();
  });

  test("image library maps every source image to its case and fleet vehicles", async ({ page }) => {
    await page.goto("/vision");
    await expect(page.getByText("Image library · 26 source images")).toBeVisible();
    await page.getByRole("tab", { name: "Month-by-month progression" }).click();
    await page.getByRole("button", { name: "Library image i7" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("1/i7.png")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "VJM 3287 history →" })).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    // a capture opens its full-resolution source, and the library can jump back to a case
    await page.getByRole("tab", { name: "All" }).first().click();
    await page.getByRole("button", { name: "Library image 17" }).click();
    await expect(page.getByRole("dialog").getByText("VehicleSense_Full_Demo/assets/split_screen_ai_vehicle_inspection.png")).toBeVisible();
    await page.getByRole("button", { name: "Open this case in the viewer" }).click();
    await expect(page.getByRole("heading", { name: "Lane 3 · Case 2" })).toBeVisible();
    await expect(page.getByText("Right rear bumper (corner)")).toBeVisible();
  });
});

test.describe("GPU models and live updates", () => {
  test("the lane console connects to the live WebSocket through the web origin", async ({ page }) => {
    await page.goto("/lane?lane=BR02-L1");
    await expect(page.getByText("Live", { exact: true })).toBeVisible();
  });

  test("the vision-language model explains a photo in plain words (when one is configured)", async ({ page, request }) => {
    const st = await (await request.get("/api/system/status")).json();
    test.skip(!st.vlm?.reachable, "no vision-language model configured (VHI_VLM_URL)");
    await page.goto("/vision");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.getByRole("button", { name: /Explain in plain words/ }).click();
    await expect(page.getByText("In plain words")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/Vision-language model · vLLM/)).toBeVisible();
  });
});

test.describe("Orientation and navigation", () => {
  test("the guided demo lists the steps and every page points to the next one", async ({ page }) => {
    await page.goto("/");
    const guide = page.locator("#guide");
    await expect(guide.getByRole("heading", { name: /Guided demo/ })).toBeVisible();
    await expect(guide.getByRole("listitem")).toHaveCount(7);
    // the primary action is "Start S1 ..." on a fresh demo and "Continue: <next step>" afterwards; either leads on
    await guide.getByRole("button", { name: /Start S1 at 4×/ }).or(guide.getByRole("link", { name: /Continue:/ })).first().click();
    await expect(page).not.toHaveURL(/\/$/);
    await page.goto("/lane?lane=BR00-L3");
    await expect(page.getByRole("link", { name: /Next:\s*Decide the alerts/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Examiner console", exact: true })).toBeVisible();
    await page.goto("/examiner?session=S1");
    await expect(page.getByRole("link", { name: /Next:\s*Read the report/ })).toBeVisible();
  });

  test("on a phone the menu drawer reaches every app", async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(process.env.E2E_BASE_URL ? `${process.env.E2E_BASE_URL}/` : "http://localhost:3000/");
    await page.getByRole("button", { name: "Open menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer.getByRole("link", { name: /Fleet intelligence/ })).toBeVisible();
    await drawer.getByRole("link", { name: /Regulator/ }).click();
    await expect(page).toHaveURL(/\/regulator/);
    await expect(page.getByRole("dialog", { name: "Navigation" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.close();
  });
});
