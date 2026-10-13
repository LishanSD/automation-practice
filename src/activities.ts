import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { Context, ApplicationFailure } from "@temporalio/activity";

export type Product = {
  name: string;
  price: string;
};

export type InventoryResult = {
  products: Product[];
  screenshotPath: string;
};

export type AddToCartResult = {
  itemName: string;
  screenshotPath: string;
};

export type ReadInventoryOptions = {
  username?: string;
  simulateFirstAttemptFailure?: boolean;
};

export async function readInventory(
  options?: ReadInventoryOptions
): Promise<InventoryResult> {
  const attempt = Context.current().info.attempt;
  const username = options?.username ?? "standard_user";

  console.log(`\n--- [Activity: readInventory] Attempt #${attempt} ---`);
  console.log(`Target username: ${username}`);

  // Level 3 Lesson: Retryable Error Simulation
  // If the flag is set and this is the first attempt, throw a standard Error.
  // Temporal's RetryPolicy will catch this and schedule a retry.
  if (options?.simulateFirstAttemptFailure && attempt === 1) {
    console.warn(
      `[Activity: readInventory] Simulating transient failure on attempt #1! (Temporal will retry)`
    );
    throw new Error(
      "Simulated transient network glitch on attempt 1 (Temporal will retry automatically based on its RetryPolicy)"
    );
  }

  // Launch a real Chromium browser.
  // Set headless: false to watch it visually in headed mode.
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--disable-save-password-bubble",
      "--disable-features=PasswordManager,PasswordsPrefPage,AutofillServerCommunication",
    ],
  });

  try {
    const page = await browser.newPage();

    // Open the SauceDemo login page.
    await page.goto("https://www.saucedemo.com", {
      waitUntil: "domcontentloaded",
    });

    // Log in with the specified user account.
    await page.locator('[data-test="username"]').fill(username);
    await page.locator('[data-test="password"]').fill("secret_sauce");
    await page.locator('[data-test="login-button"]').click();

    // Check whether login succeeded or displayed an error message.
    const inventoryLocator = page.locator(".inventory_item").first();
    const errorLocator = page.locator('[data-test="error"]');

    const outcome = await Promise.race([
      inventoryLocator.waitFor({ timeout: 15000 }).then(() => "success" as const),
      errorLocator.waitFor({ timeout: 15000 }).then(() => "error" as const),
    ]);

    // Level 3 Lesson: Non-Retryable Errors
    // A locked out user is a permanent credential/authorization failure.
    // Retrying will never succeed, so we explicitly throw a non-retryable ApplicationFailure.
    if (outcome === "error") {
      const errorText =
        (await errorLocator.textContent())?.trim() || "Login failed";
      console.error(
        `[Activity: readInventory] Non-retryable login error detected: "${errorText}"`
      );
      throw ApplicationFailure.nonRetryable(
        `User '${username}' cannot log in: ${errorText}`,
        "LockedOutUserError"
      );
    }

    // Read every product card and extract its name and price.
    const products = await page
      .locator(".inventory_item")
      .evaluateAll((items) =>
        items.map((item) => ({
          name:
            item.querySelector(".inventory_item_name")?.textContent?.trim() ??
            "",
          price:
            item.querySelector(".inventory_item_price")?.textContent?.trim() ??
            "",
        }))
      );

    // Save a screenshot for inspection.
    const screenshotDir = path.resolve("artifacts");
    await fs.mkdir(screenshotDir, { recursive: true });

    const screenshotPath = path.join(screenshotDir, "inventory.png");
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });

    console.log(
      `[Activity: readInventory] Succeeded on attempt #${attempt}. Found ${products.length} products.`
    );

    // Return structured data to the Temporal workflow.
    return { products, screenshotPath };
  } finally {
    // Close the browser even if an error occurs.
    await browser.close();
  }
}

// Resolves the LLM Stagehand should use, based on env vars (see .env.example).
// The API key is picked from the env var matching the model's provider prefix.
function resolveStagehandModel(): { modelName: string; apiKey: string } {
  const modelName = process.env.STAGEHAND_MODEL ?? "openai/gpt-4.1-mini";
  const provider = modelName.split("/")[0];

  const keyEnvByProvider: Record<string, string[]> = {
    openai: ["OPENAI_API_KEY"],
    anthropic: ["ANTHROPIC_API_KEY"],
    google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
    groq: ["GROQ_API_KEY"],
    cerebras: ["CEREBRAS_API_KEY"],
  };

  const candidates = keyEnvByProvider[provider] ?? [];
  const apiKey = candidates.map((name) => process.env[name]).find(Boolean);

  if (!apiKey) {
    // Missing config will never fix itself on retry, so fail permanently.
    throw ApplicationFailure.nonRetryable(
      `No API key found for Stagehand model '${modelName}'. Set ${
        candidates.join(" or ") || "a supported provider key"
      } in .env.`,
      "MissingApiKeyError"
    );
  }

  return { modelName, apiKey };
}

// Configures a Chrome profile with password saving and autofill prompts disabled.
async function prepareChromeProfile(): Promise<string> {
  const profileDir = path.resolve(".stagehand-profile");
  const defaultDir = path.join(profileDir, "Default");
  await fs.mkdir(defaultDir, { recursive: true });

  const prefsPath = path.join(defaultDir, "Preferences");
  const prefs = {
    credentials_enable_service: false,
    profile: {
      password_manager_enabled: false,
    },
  };
  await fs.writeFile(prefsPath, JSON.stringify(prefs, null, 2));
  return profileDir;
}

export type CartMode = "playwright" | "stagehand" | "both";

// Native Playwright implementation: fast, reliable, and requires zero LLM API keys.
export async function addToCartPlaywright(
  itemName: string,
  username?: string
): Promise<AddToCartResult> {
  const attempt = Context.current().info.attempt;
  const user = username ?? "standard_user";

  console.log(`\n--- [Activity: addToCart (Playwright)] Attempt #${attempt} ---`);
  console.log(`Target item: "${itemName}"`);
  console.log(`Target username: "${user}"`);

  const browser = await chromium.launch({
    headless: false,
    args: [
      "--disable-save-password-bubble",
      "--disable-features=PasswordManager,PasswordsPrefPage,AutofillServerCommunication",
    ],
  });

  try {
    const page = await browser.newPage();

    console.log(`[Playwright] Navigating to https://www.saucedemo.com...`);
    await page.goto("https://www.saucedemo.com", {
      waitUntil: "domcontentloaded",
    });

    console.log(`[Playwright] Logging in as '${user}'...`);
    await page.locator('[data-test="username"]').fill(user);
    await page.locator('[data-test="password"]').fill("secret_sauce");
    await page.locator('[data-test="login-button"]').click();

    const inventoryLocator = page.locator(".inventory_item").first();
    const errorLocator = page.locator('[data-test="error"]');

    const outcome = await Promise.race([
      inventoryLocator.waitFor({ timeout: 15000 }).then(() => "success" as const),
      errorLocator.waitFor({ timeout: 15000 }).then(() => "error" as const),
    ]);

    if (outcome === "error") {
      const errorText =
        (await errorLocator.textContent())?.trim() || "Login failed";
      console.error(`[Playwright] Login failed for '${user}': "${errorText}"`);
      throw ApplicationFailure.nonRetryable(
        `User '${user}' cannot log in: ${errorText}`,
        "LockedOutUserError"
      );
    }
    console.log(`[Playwright] Logged in successfully.`);

    console.log(`[Playwright] Locating product "${itemName}" and clicking Add to cart...`);
    const itemContainer = page.locator(".inventory_item", {
      has: page.locator(".inventory_item_name", { hasText: itemName }),
    });
    await itemContainer.locator("button").click();

    console.log(`[Playwright] Navigating to cart...`);
    await page.locator(".shopping_cart_link").click();
    await page.locator(".cart_item").first().waitFor();

    const screenshotDir = path.resolve("artifacts");
    await fs.mkdir(screenshotDir, { recursive: true });

    const screenshotPath = path.join(screenshotDir, "cart.png");
    console.log(`[Playwright] Capturing cart screenshot -> ${screenshotPath}`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(`[Activity: addToCart (Playwright)] Succeeded on attempt #${attempt}.\n`);
    return { itemName, screenshotPath };
  } finally {
    await browser.close();
  }
}

// Stagehand AI implementation: uses natural language instructions via LLM.
export async function addToCartStagehand(
  itemName: string,
  username?: string
): Promise<AddToCartResult> {
  const attempt = Context.current().info.attempt;
  const user = username ?? "standard_user";
  const { modelName, apiKey } = resolveStagehandModel();

  console.log(`\n--- [Activity: addToCart (Stagehand)] Attempt #${attempt} ---`);
  console.log(`Target item: "${itemName}"`);
  console.log(`Target username: "${user}"`);
  console.log(`Stagehand AI Model: "${modelName}"`);

  // Stagehand v4 is ESM-only while this project is CommonJS, so load it dynamically.
  const { Stagehand, localBrowser } = await import("@browserbasehq/stagehand");

  const profileDir = await prepareChromeProfile();

  console.log(`[Stagehand] Launching Chromium browser (with password saving disabled)...`);
  const browser = await localBrowser.launch({
    headless: false,
    userDataDir: profileDir,
    args: [
      "--disable-save-password-bubble",
      "--disable-features=PasswordManager,PasswordsPrefPage,AutofillServerCommunication",
    ],
  });
  let stagehand: Awaited<ReturnType<typeof Stagehand.create>> | undefined;

  try {
    console.log(`[Stagehand] Initializing Stagehand session with ${modelName}...`);
    stagehand = await Stagehand.create({
      browser,
      model: { modelName: modelName as any, apiKey },
    });
    console.log(`[Stagehand] Session initialized.`);

    const [page] = await browser.context.pages();

    console.log(`[Stagehand] Navigating to https://www.saucedemo.com...`);
    await page.goto("https://www.saucedemo.com");

    // Wait for the login form to render before interacting (Stagehand locators do not auto-wait like Playwright).
    await page.waitForSelector('[data-test="username"]', { timeout: 15000 });

    console.log(`[Stagehand] Logging in as '${user}' (deterministic)...`);
    await page.locator('[data-test="username"]').fill(user);
    await page.locator('[data-test="password"]').fill("secret_sauce");
    await page.locator('[data-test="login-button"]').click();

    const loggedIn = await page.waitForSelector(".inventory_item", {
      timeout: 15000,
    }).catch(() => false);

    if (!loggedIn) {
      const errorText =
        (await page
          .locator('[data-test="error"]')
          .textContent()
          .catch(() => ""))?.trim() || "Login failed";
      console.error(`[Stagehand] Login failed for '${user}': "${errorText}"`);
      throw ApplicationFailure.nonRetryable(
        `User '${user}' cannot log in: ${errorText}`,
        "LockedOutUserError"
      );
    }
    console.log(`[Stagehand] Logged in successfully. Inventory page loaded.`);

    // AI steps: Stagehand figures out the right elements from the instruction.
    console.log(`\n[Stagehand AI: Act 1] Instructing LLM to locate and add "${itemName}" to cart...`);
    const addResult = await stagehand.act(`click the "Add to cart" button for the product named "${itemName}"`);
    console.log(`   └─ Action result: "${addResult.data?.message || addResult.data?.actionDescription || "Executed"}"`);

    console.log(`[Stagehand AI: Act 2] Instructing LLM to open the shopping cart...`);
    const cartNavResult = await stagehand.act("click the shopping cart icon in the top right to open the cart");
    console.log(`   └─ Action result: "${cartNavResult.data?.message || cartNavResult.data?.actionDescription || "Executed"}"`);

    // Deterministic verification that the cart page really shows the item.
    console.log(`\n[Stagehand] Verifying cart page contains items...`);
    const cartLoaded = await page.waitForSelector(".cart_item", { timeout: 15000 });
    if (!cartLoaded) {
      throw new Error(`Cart page did not show any items after adding '${itemName}'`);
    }
    console.log(`[Stagehand] Cart verification passed. Item confirmed in cart.`);

    // Save a screenshot of the cart.
    const screenshotDir = path.resolve("artifacts");
    await fs.mkdir(screenshotDir, { recursive: true });

    const screenshotPath = path.join(screenshotDir, "cart.png");
    console.log(`[Stagehand] Capturing cart screenshot -> ${screenshotPath}`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(`[Activity: addToCart (Stagehand)] Succeeded on attempt #${attempt}.\n`);
    return { itemName, screenshotPath };
  } finally {
    console.log(`[Stagehand] Closing browser and cleaning up session.`);
    await stagehand?.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// Master addToCart activity that delegates based on the selected mode (defaults to "playwright").
// If mode is "both", it attempts Playwright first and automatically falls back to Stagehand if Playwright fails.
export async function addToCart(
  itemName: string,
  username?: string,
  mode: CartMode = "playwright"
): Promise<AddToCartResult> {
  if (mode === "stagehand") {
    return addToCartStagehand(itemName, username);
  }

  if (mode === "both") {
    console.log(`\n[Mode: Both] Attempting with native Playwright first...`);
    try {
      return await addToCartPlaywright(itemName, username);
    } catch (error: any) {
      // Permanent authentication errors should not fallback (account is locked)
      if (error instanceof ApplicationFailure && error.type === "LockedOutUserError") {
        throw error;
      }
      console.warn(
        `\n[Mode: Both] Playwright failed: "${error?.message || error}".`
      );
      console.log(`[Mode: Both] Falling back to Stagehand AI agent...`);
      return await addToCartStagehand(itemName, username);
    }
  }

  return addToCartPlaywright(itemName, username);
}

