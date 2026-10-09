import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

export type Product = {
  name: string;
  price: string;
};

export type InventoryResult = {
  products: Product[];
  screenshotPath: string;
};

export async function readInventory(): Promise<InventoryResult> {
  // Launch a real Chromium browser in headless mode.
  // Set headless: false if want to watch it work.
  const browser = await chromium.launch({ headless: false });

  try {
    const page = await browser.newPage();

    // Open the SauceDemo login page.
    await page.goto("https://www.saucedemo.com", {
      waitUntil: "domcontentloaded",
    });

    // Log in using the practice site's standard account.
    await page.locator('[data-test="username"]').fill("standard_user");
    await page.locator('[data-test="password"]').fill("secret_sauce");
    await page.locator('[data-test="login-button"]').click();

    // Wait until the inventory page is displayed.
    await page.locator(".inventory_item").first().waitFor();

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
        })),
      );

    // Save a screenshot for inspection.
    const screenshotDir = path.resolve("artifacts");
    await fs.mkdir(screenshotDir, { recursive: true });

    const screenshotPath = path.join(screenshotDir, "inventory.png");
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });

    // Return structured data to the Temporal workflow.
    return { products, screenshotPath };
  } finally {
    // Close the browser even if an error occurs.
    await browser.close();
  }
}
