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
      `[Activity: readInventory] 💥 Simulating transient failure on attempt #1! (Temporal will retry)`
    );
    throw new Error(
      "Simulated transient network glitch on attempt 1 (Temporal will retry automatically based on its RetryPolicy)"
    );
  }

  // Launch a real Chromium browser.
  // Set headless: false to watch it visually in headed mode.
  const browser = await chromium.launch({ headless: false });

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
        `[Activity: readInventory] 🚫 Non-retryable login error detected: "${errorText}"`
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
      `[Activity: readInventory] ✅ Succeeded on attempt #${attempt}. Found ${products.length} products.`
    );

    // Return structured data to the Temporal workflow.
    return { products, screenshotPath };
  } finally {
    // Close the browser even if an error occurs.
    await browser.close();
  }
}

export async function addToCart(
  itemName: string,
  username?: string
): Promise<AddToCartResult> {
  const user = username ?? "standard_user";
  const browser = await chromium.launch({ headless: false });

  try {
    const page = await browser.newPage();

    // Open the SauceDemo login page.
    await page.goto("https://www.saucedemo.com", {
      waitUntil: "domcontentloaded",
    });

    // Log in using the practice site's account.
    await page.locator('[data-test="username"]').fill(user);
    await page.locator('[data-test="password"]').fill("secret_sauce");
    await page.locator('[data-test="login-button"]').click();

    // Check for login errors.
    const inventoryLocator = page.locator(".inventory_item").first();
    const errorLocator = page.locator('[data-test="error"]');

    const outcome = await Promise.race([
      inventoryLocator.waitFor({ timeout: 15000 }).then(() => "success" as const),
      errorLocator.waitFor({ timeout: 15000 }).then(() => "error" as const),
    ]);

    if (outcome === "error") {
      const errorText =
        (await errorLocator.textContent())?.trim() || "Login failed";
      throw ApplicationFailure.nonRetryable(
        `User '${user}' cannot log in: ${errorText}`,
        "LockedOutUserError"
      );
    }

    // Locate the chosen product container.
    const itemContainer = page.locator(".inventory_item", {
      has: page.locator(".inventory_item_name", { hasText: itemName }),
    });

    // Click "Add to cart" for that product.
    await itemContainer.locator("button").click();

    // Navigate to the cart to show the item was added, and stop there without checking out.
    await page.locator(".shopping_cart_link").click();
    await page.locator(".cart_item").first().waitFor();

    // Save a screenshot of the cart.
    const screenshotDir = path.resolve("artifacts");
    await fs.mkdir(screenshotDir, { recursive: true });

    const screenshotPath = path.join(screenshotDir, "cart.png");
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });

    return { itemName, screenshotPath };
  } finally {
    await browser.close();
  }
}

