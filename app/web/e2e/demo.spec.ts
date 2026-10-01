import { APIRequestContext, expect, Page, test as base } from "@playwright/test";
import { STATE } from "./global-setup";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
/** The tests' own API calls use the presenter's session too. */
const test = base.extend({
  request: async ({ playwright, baseURL }, use) => {
    const ctx = await playwright.request.newContext({ baseURL, storageState: STATE });
    await use(ctx);
    await ctx.dispose();
  },
});

/** Fast-forward a lane session through the API (the same call the "Fast-forward" button makes). */
async function fastForward(request: APIRequestContext, sid: string) {
  const r = await request.post(`/api/sessions/${sid}/start`, { data: { fast: true }, timeout: 180_000 });
  expect(r.ok(), `${sid} fast start`).toBeTruthy();
  return r.json();
}

/** Start a use case through the API (the Start button's call) and return its progress. */
async function startUseCase(request: APIRequestContext, id: string) {
  const r = await request.post(`/api/usecases/${id}/start`, { timeout: 60_000 });
  expect(r.ok(), `${id} start`).toBeTruthy();
  return r.json();
}

/** Decide every open finding in the examiner workspace: the focused one, then the next that opens by itself. */
async function confirmAll(page: Page) {
  const confirm = page.getByRole("button", { name: "Confirm finding" });
  for (let i = 0; i < 40 && (await confirm.count()) > 0; i++) {
    const title = await page.locator("h2.font-display").first().textContent();
    await confirm.click();
    await expect(page.locator("h2.font-display").first()).not.toHaveText(title || "", { timeout: 20_000 }).catch(() => {});
  }
  await expect(confirm).toHaveCount(0);
}

test.describe("Demo control", () => {
  test("shows the nine use cases and starts one from the page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Every inspection, from lane to verified result" })).toBeVisible();
    const cases = page.locator("#usecases article");
    await expect(cases).toHaveCount(9);
    for (let i = 1; i <= 9; i++) await expect(page.getByRole("article", { name: new RegExp(`^UC-0${i} `) })).toBeVisible();
    // each card says the vehicle, the scenario, the expected outcome, the time and where its data comes from
    const uc4 = page.getByRole("article", { name: /^UC-04 / });
    await expect(uc4.getByText("Expected outcome:")).toBeVisible();
    await expect(uc4.getByText(/~4 min/)).toBeVisible();
    await expect(uc4.getByText("SIMULATED", { exact: true })).toBeVisible();
    // keyboard: the Start button is reachable and works with Enter
    await uc4.getByRole("button", { name: "Start" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/lane\?lane=BR00-L4/, { timeout: 60_000 });
    await expect(page.getByRole("link", { name: /UC-04/ })).toBeVisible();
  });

  test("the data-label legend explains every provenance label", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "What the data labels mean" }).click();
    const dialog = page.getByRole("dialog", { name: "What the data labels mean" });
    for (const l of ["LIVE FEED", "PUBLIC DATA", "LIVE MODEL", "LIVE LOGIC", "SIMULATED", "SYNTHETIC", "SAMPLE", "MOCK", "FUTURE R&D"])
      await expect(dialog.getByText(l, { exact: true })).toBeVisible();
  });
});

test.describe("UC-04 clean inspection", () => {
  test("no anomalies: the examiner issues a PASS and the passport updates", async ({ page, request }) => {
    await startUseCase(request, "UC-04");
    await fastForward(request, "S7");
    await page.goto("/lane?lane=BR00-L4");
    await expect(page.getByText("No anomalies detected in this inspection.")).toBeVisible();
    await page.getByRole("link", { name: /Review AI findings/ }).first().click();
    await expect(page.getByRole("heading", { name: "Examiner workspace" })).toBeVisible();
    await expect(page.getByText("No anomalies detected in this inspection")).toBeVisible();
    await page.getByRole("button", { name: "Issue report", exact: true }).click();
    await expect(page).toHaveURL(/\/report\?id=/);
    await expect(page.getByText("Inspection complete: report issued")).toBeVisible();
    await expect(page.getByText("PASS", { exact: true }).first()).toBeVisible();
    await page.getByRole("link", { name: /Open the health passport/ }).click();
    await expect(page).toHaveURL(/\/owner\?plate=DMO(%20|\+)9006&tab=passport/);
    await expect(page.getByRole("link", { name: /UC-04\s*complete/ })).toBeVisible();
  });
});

test.describe("UC-01 commercial vehicle: lane → examiner → report → verification", () => {
  test("critical findings first, reasons enforced, decisions advance, FAIL report, buyer verifies it", async ({ page, request }) => {
    await startUseCase(request, "UC-01");
    await fastForward(request, "S1");
    await page.goto("/lane?lane=BR00-L3");
    await expect(page.getByText("What the lane has found")).toBeVisible();
    await expect(page.getByRole("heading", { name: "DMO 9001", exact: true }).or(page.getByText("DMO 9001").first()).first()).toBeVisible();

    await page.goto("/examiner?session=S1");
    await expect(page.getByRole("heading", { name: "Examiner workspace" })).toBeVisible();
    await expect(page.getByText(/^Findings \(\d+\)/)).toBeVisible();
    await expect(page.getByRole("tab", { name: "Lane 3 · DMO 9001" })).toHaveAttribute("aria-selected", "true");
    // the report waits for the critical findings, and says so
    await expect(page.getByRole("button", { name: /Decide \d+ critical findings? first/ })).toBeDisabled();
    await expect(page.getByText("Why was this flagged?")).toBeVisible();
    // dismissing without a reason is refused
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(page.getByText(/Add a short reason \(at least 3 characters\)/)).toBeVisible();
    // keyboard: the arrow keys move through the findings
    const options = page.getByRole("listbox", { name: "Findings" }).getByRole("option");
    await options.first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");

    await confirmAll(page);
    await expect(page.getByText(/(\d+) of \1 critical findings? reviewed/)).toBeVisible();
    const issue = page.getByRole("button", { name: "Issue report", exact: true });
    await expect(issue).toBeEnabled();
    await issue.click();
    await expect(page).toHaveURL(/\/report\?id=/);
    await expect(page.getByText("FAIL", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Evidence chain intact")).toBeVisible();
    // the use case's downstream update: the fleet's vehicle record shows the result
    await page.getByRole("link", { name: /Open the fleet record/ }).click();
    await expect(page.getByText("Latest inspection", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Verify", exact: true }).click();
    await expect(page).toHaveURL(/\/verify\//);
    await expect(page.getByText("Genuine, unaltered report")).toBeVisible();
  });

  test("the workspace never shows a partial inspection when the live feed answers before the full load", async ({ page, request }) => {
    const n = (await (await request.get("/api/inspections/latest", { params: { session_id: "S1" } })).json()).alerts.length;
    // hold back the full load: on connect the live feed replays only the last message of each kind (one alert and
    // the health score), which must not be shown as if it were the whole inspection
    await page.route(/\/api\/inspections\/latest/, async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.goto("/examiner?session=S1");
    await expect(page.getByText("Vehicle health", { exact: true })).toBeVisible();
    expect(await page.getByText(/^Findings \(\d+\)/).textContent()).toBe(`Findings (${n})`);
  });
});

test.describe("UC-02 EV flood risk and UC-03 senior review", () => {
  test("UC-02: the flood evidence and a CONDITIONAL EV Health Certificate", async ({ page, request }) => {
    await startUseCase(request, "UC-02");
    await fastForward(request, "S2");
    await page.goto("/examiner?session=S2");
    await expect(page.getByText("DMO 9002").first()).toBeVisible();
    await expect(page.getByText(/Likely flood damage/).first()).toBeVisible();
    await page.getByRole("button", { name: /Confirm all \d+ remaining/ }).click();
    await page.getByRole("button", { name: "Issue report", exact: true }).click();
    await expect(page.getByText("CONDITIONAL", { exact: true }).first()).toBeVisible();
  });

  test("UC-03: identity checks disagree, so the senior examiner signs the report off", async ({ page, request }) => {
    await startUseCase(request, "UC-03");
    await fastForward(request, "S3");
    await page.goto("/examiner?session=S3");
    await expect(page.getByText("Senior review required.")).toBeVisible();
    await page.getByRole("button", { name: /Confirm all \d+ remaining/ }).click();
    await page.getByRole("button", { name: "Refer to the senior examiner" }).click();
    await expect(page.getByRole("combobox", { name: "Examiner" })).toHaveValue("VE001");
    await page.getByRole("button", { name: "Sign off and issue the report" }).click();
    await expect(page).toHaveURL(/\/report\?id=/);
    await expect(page.getByText(/Priya Hassan \(Senior Examiner\)/)).toBeVisible();
  });
});

test.describe("UC-07 HQ exceptions", () => {
  test("an exception's evidence, a recorded action, and the tamper test", async ({ page, request }) => {
    await startUseCase(request, "UC-07");
    await page.goto("/hq");
    await expect(page.getByRole("heading", { name: "HQ operations" })).toBeVisible();
    const card = page.locator("article").filter({ hasText: "(VE017)" });
    await expect(card.getByText(/standard deviations above other examiners/)).toBeVisible();
    await card.getByRole("link", { name: /Show the evidence/ }).click();
    await expect(page).toHaveURL(/examiner=VE017/);
    await expect(page.getByText(/Passes by VE017 that breach a fail threshold/)).toBeVisible();
    await card.getByLabel(/Note for/).fill("Pull the last 20 heavy-vehicle passes");
    await card.getByRole("button", { name: "Open an integrity review" }).click();
    await expect(card.getByText(/Integrity review opened by presenter/)).toBeVisible();
    await expect(page.getByRole("link", { name: /UC-07\s*complete/ })).toBeVisible();
    await expect(page.getByText("All records intact")).toBeVisible();
    await page.getByRole("button", { name: "Run tamper test" }).click();
    await expect(page.getByText(/Tamper detected at entry #\d+; record restored/)).toBeVisible();
    await expect(page.getByText(/restored → intact again/)).toBeVisible();
  });

  test("HQ keeps its layout while the exceptions load", async ({ page }) => {
    await page.route(/\/api\/hq\/exceptions/, async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    await page.goto("/hq");
    await expect(page.getByText("Checking every hub for exceptions…")).toBeVisible();
    await expect(page.getByRole("heading", { name: "HQ operations" })).toBeVisible();
  });
});

test.describe("UC-06 fleet predictive maintenance", () => {
  test("the use case's truck is pinned, its trend explains why, and it is booked", async ({ page, request }) => {
    await startUseCase(request, "UC-06");
    await page.goto("/fleet?fleet=FLEET07");
    await expect(page.getByText(/UC-06 vehicle/)).toBeVisible();
    await page.getByRole("link", { name: /Open its history/ }).click();
    await expect(page).toHaveURL(/\/fleet\/vehicle\/DMO(%20| )9001/);
    await expect(page.getByText("Tread depth, worst tyre").first()).toBeVisible();
    await page.getByRole("button", { name: /Book an inspection before the fail date/ }).click();
    await expect(page.getByText("Inspection booked")).toBeVisible();
  });
});

test.describe("Fleet and regulator", () => {
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
    const book = page.getByRole("button", { name: "Book inspection", exact: true });
    if ((await book.count()) > 0) await book.click(); // already booked on a re-run
    await expect(page.getByRole("button", { name: /^Booked / })).toBeVisible();
  });

  test("FLEET07 shows the next periodic inspection fail risk", async ({ page }) => {
    await page.goto("/fleet?fleet=FLEET07");
    await expect(page.getByText(/FLEET07 · next periodic inspection: fail risk/)).toBeVisible();
  });

  test("a filter with no result says so and clears", async ({ page }) => {
    await page.goto("/fleet?fleet=OP-KAS&type=Bus");
    await expect(page.getByText("No vehicles match the selected filters")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByText("No vehicles match the selected filters")).toHaveCount(0);
  });

  test("regulator view shows real registrations and synthetic defect trends", async ({ page }) => {
    await page.goto("/regulator");
    await expect(page.getByText("1,629,552")).toBeVisible();
    await expect(page.getByText("Inspection fail rate and top defects")).toBeVisible();
    await expect(page.getByText("High-emitter hits (latest)")).toBeVisible();
  });
});

test.describe("Flood watch", () => {
  test("JPS stations by status, districts at risk and the vehicles to inspect", async ({ page, request }) => {
    const o = await (await request.get("/api/floodwatch")).json();
    await page.goto("/flood");
    await expect(page.getByRole("heading", { name: "Flood watch" })).toBeVisible();
    // every panel says where its data comes from: a live fetch (with its time) or the stored snapshot
    await expect(page.getByText(/(LIVE FEED· JPS Public InfoBanjir · fetched|PUBLIC DATA· Stored JPS snapshot, fetched)/).first()).toBeVisible();
    await expect(page.getByText(/Last updated|Live feed unavailable:/)).toBeVisible();
    await expect(page.getByRole("img", { name: "JPS water-level stations by status" })).toBeVisible();
    await expect(page.getByText("Stations by state")).toBeVisible();
    await expect(page.getByText("SYNTHETIC· Vehicles and districts")).toBeVisible();
    const exposed = o.live.high + o.live.medium;
    if (exposed) await expect(page.locator("[data-flood-vehicle]").first()).toBeVisible();
    else await expect(page.getByText(/No (district is exposed|vehicle is exposed|vehicle at risk)/).first()).toBeVisible();
  });

  test("a past flood ranks the claimants first; a vehicle's reasons and the mock invitation", async ({ page }) => {
    await page.goto("/flood");
    await page.getByRole("tab", { name: /Dec 2021 · Klang Valley floods/ }).click();
    await expect(page.getByText(/Real event \(public record\)/)).toBeVisible();
    await expect(page.getByText("SYNTHETIC· Claims").first()).toBeVisible();
    const first = page.locator("[data-flood-vehicle]").first();
    await expect(first.getByText(/Flood insurance claim for this flood/)).toBeVisible();
    await first.getByRole("button", { name: "Details" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("How the score adds up")).toBeVisible();
    await expect(dialog.getByText(/-> risk \d+/)).toBeVisible();
    await expect(dialog.getByText(/Recorded only: no SMS, e-mail or letter is sent/)).toBeVisible();
    const invite = dialog.getByRole("button", { name: "Invite the owner for a flood inspection" });
    if (await invite.count()) {
      await invite.click();
      await expect(page.getByText(/Invitation recorded for .* \(mock: no message is sent\)/)).toBeVisible();
    }
    await expect(dialog.getByText(/^Invitation recorded /)).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText("Invitations sent")).toBeVisible();
  });

  test("UC-08: the at-risk EV is invited (mock), inspected, and its result closes the loop", async ({ page, request }) => {
    const uc = await startUseCase(request, "UC-08");
    await page.goto(uc.next.href);
    await expect(page.getByRole("tab", { name: /Dec 2025 · claims/ })).toHaveAttribute("aria-selected", "true");
    await page.goto(uc.steps[1].href);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Flood-damage inspection").first()).toBeVisible();
    await dialog.getByRole("button", { name: "Invite the owner for a flood inspection" }).click();
    await expect(dialog.getByText(/^Invitation recorded /)).toBeVisible();
    await expect(dialog.getByText(/Invited: the result appears here once the vehicle has been inspected/)).toBeVisible();
    await fastForward(request, "S2");
    const insp = await (await request.get("/api/inspections/latest", { params: { session_id: "S2" } })).json();
    for (const a of insp.alerts) await request.post(`/api/inspections/alerts/${a.alert_id}/decision`, { data: { action: "confirm", examiner_id: "VE011" } });
    await request.post(`/api/inspections/${insp.inspection_id}/report`, { data: { examiner_id: "VE011" } });
    await page.reload();
    await expect(page.getByRole("dialog").getByText("CONDITIONAL", { exact: true })).toBeVisible();
  });
});

test.describe("UC-05 owner app", () => {
  test("assistant answers in BM and offers Express slots", async ({ page }) => {
    await page.goto("/owner?plate=DMO%209006&tab=chat");
    await page.getByLabel("Message").fill("Saya nak jual kereta, pemeriksaan apa yang saya perlu?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/Pindah Milik/i).last()).toBeVisible();
    await page.getByLabel("Message").fill("Ada slot esok di Central Inspection Hub?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/Ekspres|Express/).last()).toBeVisible();
  });

  test("self-check fails first, passes after fixing", async ({ page }) => {
    await page.goto("/owner?plate=DMO%209006&tab=check");
    await page.getByRole("button", { name: "Run self-check" }).click();
    await expect(page.getByText("Fix these first")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Window tint").first()).toBeVisible();
    await page.getByRole("button", { name: "Run again after fixing" }).click();
    await expect(page.getByText("Ready for inspection")).toBeVisible({ timeout: 60_000 });
  });

  test("books and pays for an inspection, gets a check-in QR", async ({ page }) => {
    await page.goto("/owner?plate=DMO%209006&tab=book");
    const slot = page.locator("div.grid-cols-4 button:not([aria-label$='full'])").first();
    await expect(slot).toBeVisible();
    await slot.click();
    await page.getByRole("button", { name: /^Pay RM/ }).click();
    await expect(page.getByText("Booking confirmed")).toBeVisible();
    await expect(page.getByAltText("Check-in QR code")).toBeVisible();
    await expect(page.getByText("Check-in code", { exact: true })).toBeVisible();
    await expect(page.getByText("MOCK", { exact: true })).toBeVisible();
  });

  test("a full slot suggests the nearest branches with that time free, on the same screen", async ({ page }) => {
    await page.goto("/owner?plate=DMO%209006&tab=book");
    const full = page.locator("div.grid-cols-4 button[aria-label$='full']").first();
    await expect(full).toBeVisible();
    const time = (await full.getAttribute("aria-label"))!.replace(" full", "");
    await full.click();
    await expect(page.getByText(`${time} is full at Central Inspection Hub.`)).toBeVisible();
    await page.getByRole("button", { name: / km/ }).first().click();
    await expect(page.getByLabel("Branch")).not.toHaveValue("BR00");
    await expect(page.getByRole("button", { name: /^Pay RM .* and book/ })).toBeEnabled();
  });

  test("UC-05: self-check, booking and check-in, the inspection, and the passport", async ({ page, request }) => {
    const uc = await startUseCase(request, "UC-05");
    await page.goto(uc.next.href);
    await page.getByRole("button", { name: "Run again after fixing" }).click();
    await expect(page.getByText("Ready for inspection")).toBeVisible({ timeout: 60_000 });
    await page.goto("/owner?plate=DMO%209006&tab=book");
    await page.getByRole("button", { name: /^Voluntary Inspection/ }).click();
    const slot = page.locator("div.grid-cols-4 button:not([aria-label$='full'])").first();
    await slot.click();
    await page.getByRole("button", { name: /^Pay RM/ }).click();
    await expect(page.getByText("Booking confirmed")).toBeVisible();
    // the lane: the plate camera checks the booking in, the inspection runs, nothing needs a decision
    await fastForward(request, "S7");
    await page.goto("/lane?lane=BR00-L4");
    await expect(page.getByText(/Booking BK\w+ checked in/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Inspection in context" }).getByText("Voluntary Inspection", { exact: false })).toBeVisible();
    await page.goto("/examiner?session=S7");
    await page.getByRole("button", { name: "Issue report", exact: true }).click();
    await expect(page).toHaveURL(/\/report\?id=/);
    await page.getByRole("link", { name: /Open the passport/ }).click();
    await expect(page.getByText(/Health certificates · \d+/)).toBeVisible();
    await expect(page.getByText("Voluntary inspection report").first()).toBeVisible();
    const done = await (await request.get("/api/usecases/active")).json();
    expect(done.active.complete).toBeTruthy();
  });

  test("the passport lists every health certificate", async ({ page }) => {
    await page.goto("/owner?plate=DMO%209006&tab=passport");
    await expect(page.getByText(/Health certificates · \d+/)).toBeVisible();
    await expect(page.getByText("Voluntary Inspection").first()).toBeVisible();
  });
});

test.describe("Used-vehicle sales", () => {
  test("oversight lists every car and motorcycle for sale and opens a vehicle's whole record", async ({ page }) => {
    await page.goto("/sales");
    await expect(page.getByRole("heading", { name: "Used-vehicle sales" })).toBeVisible();
    await expect(page.getByText(/\d+ cars · 15 motorcycles/)).toBeVisible();
    await page.getByRole("tab", { name: "Motorcycles" }).click();
    await expect(page).toHaveURL(/kind=motorcycle/);
    await expect(page.getByText("15 of 55")).toBeVisible();
    await page.getByRole("tab", { name: "All", exact: true }).click();
    await page.getByLabel("Search listings").fill("DMO 9003");
    await page.getByRole("link", { name: "DMO 9003", exact: true }).click();
    await expect(page).toHaveURL(/\/sales\?id=LS\d+/);
    await expect(page.getByRole("heading", { name: /DMO 9003 · Honda Civic/ })).toBeVisible();
    const summary = page.getByRole("list", { name: "Trust summary" });
    await expect(summary.getByText(/86,500 km/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Inspection history \(\d+\)/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "OBD fault codes" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Odometer" })).toBeVisible();
    await page.getByText(/What the lane measured/).first().click();
    await expect(page.getByText("Brake efficiency").first()).toBeVisible();
    // an ex-fleet car's inspection photos open in the image viewer
    await page.goto("/sales?q=VJM%203287");
    await page.getByRole("link", { name: "VJM 3287", exact: true }).click();
    await page.getByRole("button", { name: "Library image i7" }).click();
    await expect(page.getByRole("dialog", { name: /Image i7/ })).toBeVisible();
  });

  test("UC-09: a buyer reviews the latest report and verifies it without a login", async ({ page, request, browser }) => {
    const uc = await startUseCase(request, "UC-09");
    await page.goto("/sales");
    await page.getByLabel("Search listings").fill("DMO 9003");
    await page.getByRole("link", { name: "DMO 9003", exact: true }).click();
    await expect(page.getByText("Latest inspection report")).toBeVisible();
    await page.getByRole("button", { name: "Review the report" }).click();
    await expect(page.getByText("Odometer then")).toBeVisible();
    const verify = page.getByRole("link", { name: "Verify this report" });
    const href = (await verify.getAttribute("href"))!;
    await verify.click();
    await expect(page.getByText("Genuine, unaltered report")).toBeVisible();
    await expect(page.getByText("Odometer at inspection")).toBeVisible();
    await expect(page.getByRole("link", { name: /UC-09/ })).toHaveCount(0);  // the verify page is public, no app shell
    const done = await (await request.get("/api/usecases/active")).json();
    expect(done.active.id).toBe(uc.id);
    expect(done.active.complete).toBeTruthy();
    // a buyer's phone: no session at all
    const anon = await browser.newPage({ storageState: { cookies: [], origins: [] } });
    await anon.goto(BASE + href);
    await expect(anon.getByText("Genuine, unaltered report")).toBeVisible();
    await anon.goto(BASE + "/verify/not-a-real-code");
    await expect(anon.getByText("No report matches this code")).toBeVisible();
    await anon.close();
  });

  test("owner app: the Sale tab shows a motorcycle's record end to end, and a car's photos", async ({ page }) => {
    await page.goto("/owner?tab=sale");
    await expect(page.getByText("Vehicles for sale")).toBeVisible();
    await page.getByRole("group", { name: "Vehicle type" }).getByRole("button", { name: "Motorcycles" }).click();
    await page.getByRole("button", { name: /Honda RS150R/ }).click();
    await expect(page).toHaveURL(/listing=LS\d+/);
    const record = page.getByRole("region", { name: "What the record says" });
    await expect(record.getByText("Serious red flags")).toBeVisible();
    await expect(record.getByText(/Odometer rollback/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /Inspection history \(4\)/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "OBD fault codes" })).toBeVisible();
    await expect(page.getByText(/No photos on file yet/)).toBeVisible();
    await page.getByRole("button", { name: "‹ All for sale" }).click();
    await page.getByRole("group", { name: "Vehicle type" }).getByRole("button", { name: "All" }).click();
    await page.getByLabel("Search vehicles for sale").fill("WVA");
    await page.getByRole("button", { name: /WVA 1209/ }).click();
    await page.getByRole("button", { name: /^Photo \d+: Close-up · brake pads/ }).click();
    await expect(page.getByText(/Close-up · brake pads/).first()).toBeVisible();
  });
});

test.describe("AI vision", () => {
  test("shows the three AI inspection modules and runs a live model on a capture", async ({ page }) => {
    await page.goto("/vision");
    await expect(page.getByRole("heading", { name: "AI vision inspection" })).toBeVisible();
    for (const name of ["Undercarriage AI", "Above-carriage AI", "Tyre AI"]) await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Live model result" })).toBeVisible({ timeout: 60_000 });
  });

  test("image library maps every source image to its case and fleet vehicles", async ({ page }) => {
    await page.goto("/vision");
    await page.getByRole("tab", { name: /Image library · 26/ }).click();
    await expect(page).toHaveURL(/view=library/);
    await page.getByRole("tab", { name: /Progressions · 3/ }).click();
    await page.getByRole("button", { name: "Library image i7" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("1/i7.png")).toBeVisible();
    await expect(dialog.getByRole("link", { name: /VJM 3287 history/ })).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // an image opens its case in the captures view
    await page.getByRole("tab", { name: /^All/ }).click();
    await page.getByRole("button", { name: "Library image 17" }).click();
    await expect(page.getByRole("dialog").getByText("VehicleSense_Full_Demo/assets/split_screen_ai_vehicle_inspection.png")).toBeVisible();
    await page.getByRole("button", { name: "Open the case in AI vision" }).click();
    await expect(page.getByRole("heading", { name: "Lane 3 · Case 2" })).toBeVisible();
    await expect(page.getByText("Right rear bumper (corner)")).toBeVisible();
    await expect(page).toHaveURL(/case=23/);
  });

  test("a vehicle's inspection images open in the viewer, with findings and keyboard navigation", async ({ page }) => {
    await page.goto("/fleet/vehicle/VKR%203128");
    await expect(page.getByRole("heading", { name: /Inspection images/ })).toBeVisible();
    await page.getByRole("button", { name: "Library image 07" }).click();
    const dialog = page.getByRole("dialog", { name: /Image 07/ });
    await expect(dialog.getByText("Findings (3)")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("dialog", { name: /Image i1/ }).getByText("1. Disc scoring", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // the fleet table's evidence thumbnails open the same viewer
    await page.goto("/fleet");
    await page.getByRole("button", { name: "With photos" }).click();
    await page.getByRole("button", { name: "Open image 07 of VKR 3128" }).click();
    await expect(page.getByRole("dialog", { name: /Image 07/ })).toBeVisible();
  });
});

test.describe("GPU models and live updates", () => {
  test("the lane console connects to the live WebSocket through the web origin", async ({ page }) => {
    await page.goto("/lane?lane=BR00-L1");
    await expect(page.getByText("Live", { exact: true })).toBeVisible();
  });

  test("the vision-language model explains a photo in plain words (when one is configured)", async ({ page, request }) => {
    const st = await (await request.get("/api/system/status")).json();
    test.skip(!st.vlm?.reachable, "no vision-language model configured (VHI_VLM_URL)");
    await page.goto("/vision");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.getByRole("button", { name: /Explain in plain words/ }).click();
    await expect(page.getByText("In plain words")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/Vision-language model · (vLLM|TensorRT-LLM|Ollama|LLM server) · /)).toBeVisible();
  });
});

test.describe("Orientation and navigation", () => {
  test("every inspection screen shows the inspection in context and the running use case", async ({ page, request }) => {
    await startUseCase(request, "UC-01");
    await fastForward(request, "S1");
    for (const path of ["/lane?lane=BR00-L3", "/examiner?session=S1"]) {
      await page.goto(path);
      const bar = page.getByRole("region", { name: "Inspection in context" });
      await expect(bar.getByText("DMO 9001", { exact: true })).toBeVisible();
      await expect(bar.getByText(/Central Inspection Hub · Lane 3/)).toBeVisible();
      await expect(bar.getByText("Arjun Ismail")).toBeVisible();
      await expect(bar.getByText(/UC-01/)).toBeVisible();
      await expect(bar.getByRole("list", { name: "Journey" })).toBeVisible();
    }
  });

  test("no client-specific branding or service codes appear anywhere in the apps", async ({ page, request }) => {
    const reports = await (await request.get("/api/reports", { params: { limit: 5 } })).json();
    const pages = ["/", "/lane?lane=BR00-L3", "/examiner?session=S1", "/report", "/vision", "/fleet", "/fleet/vehicle/DMO%209001",
      "/owner?plate=DMO%209006&tab=passport", "/owner?plate=DMO%209006&tab=book", "/owner?plate=DMO%209006&tab=chat", "/hq", "/regulator",
      "/sales", "/sales?id=LS0001", "/flood", "/login", ...reports.map((r: any) => `/verify/${r.verify_token}`)];
    const banned = /PUSPAKOM|Puspakom|\bJPJ\b|Berkala|\bB[257]\b|MV15|mySIKAP|\bGEAR\b|Alam Megah|Glenmarie|Batu Caves|hire-purchase/;
    const found: Record<string, string> = {};
    for (const path of pages) {
      await page.goto(path, { waitUntil: "networkidle" });
      const text = (await page.locator("body").innerText()) + " " + (await page.title());
      const m = text.match(banned);
      if (m) found[path] = m[0];
    }
    expect(found).toEqual({});
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

  for (const width of [390, 360]) {
    test(`on a ${width} px phone no app scrolls sideways`, async ({ browser }) => {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const base = process.env.E2E_BASE_URL || "http://localhost:3000";
      const wide: Record<string, number> = {};  // page -> pixels it scrolls sideways
      for (const path of ["/", "/lane", "/examiner", "/report", "/vision", "/fleet", "/fleet/vehicle/VKR%203128", "/owner", "/hq", "/regulator",
        "/sales", "/sales?id=LS0001", "/owner?tab=sale&listing=LS0003", "/flood", "/flood?scope=event%3A2025-12-10&vehicle=DMO%209002"]) {
        await page.goto(base + path, { waitUntil: "networkidle" });  // with its data: wide tables only appear then
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (over > 1) wide[path] = over;
      }
      expect(wide).toEqual({});
      await page.close();
    });
  }
});

test.describe("Login and roles", () => {
  async function logIn(page: Page, name: string, password: string) {
    await page.getByRole("radio", { name: new RegExp(name) }).click();
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
  }

  test("a visitor logs in and lands on the apps of their role", async ({ browser }) => {
    const page = await browser.newPage({ storageState: { cookies: [], origins: [] } });
    await page.goto(`${BASE}/hq`);
    await expect(page).toHaveURL(/\/login\?next=%2Fhq/);
    await logIn(page, "Arjun Ismail", "not the password");
    await expect(page.getByText("Wrong username or password.")).toBeVisible();
    await page.getByLabel("Password").fill(process.env.E2E_PASSWORD || "");
    await page.getByRole("button", { name: "Log in" }).click();
    // back to the page asked for, which the examiner may not open: their own apps instead
    await expect(page.getByRole("heading", { name: "Not available to this account" })).toBeVisible();
    await page.getByRole("link", { name: /Go to your apps/ }).click();
    await expect(page.getByRole("heading", { name: "Lane console" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Apps" });
    await expect(nav.getByRole("link", { name: /Examiner/ })).toBeVisible();
    await expect(nav.getByRole("link", { name: /HQ operations|Owner app|Demo control/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.close();
  });

  test("the viewer reads the examiner console but cannot decide", async ({ browser }) => {
    const page = await browser.newPage({ storageState: { cookies: [], origins: [] } });
    await page.goto(`${BASE}/login?next=%2Fexaminer%3Fsession%3DS1`);
    await logIn(page, "Guest viewer", process.env.E2E_VIEWER_PASSWORD || process.env.E2E_PASSWORD || "");
    await expect(page.getByRole("heading", { name: "Examiner workspace" })).toBeVisible();
    await expect(page.getByText("Read only", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm finding" })).toHaveCount(0);
    await page.close();
  });
});
