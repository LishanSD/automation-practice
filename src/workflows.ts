import {
  proxyActivities,
  defineSignal,
  setHandler,
  condition,
} from "@temporalio/workflow";
import type * as activities from "./activities";
import type { InventoryResult, AddToCartResult } from "./activities";

// Configure activities' timeout and retry behaviour.
const { readInventory, addToCart } = proxyActivities<typeof activities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    maximumAttempts: 2,
  },
});

export type ApproveInput = string | { item?: string };

// Signals
export const approveSignal = defineSignal<[ApproveInput?]>("approve");
export const rejectSignal = defineSignal("reject");

export type WorkflowResult = {
  status: "approved" | "rejected";
  inventory: InventoryResult;
  cart?: AddToCartResult;
  message: string;
};

export async function inventoryWorkflow(): Promise<WorkflowResult> {
  // 1. The workflow delegates reading inventory to the first activity.
  const inventoryResult = await readInventory();

  // 2. Pause and wait for an approve or reject signal.
  let decision: "approved" | "rejected" | null = null;
  let chosenItem: string | undefined = undefined;

  setHandler(approveSignal, (input?: ApproveInput) => {
    decision = "approved";
    if (typeof input === "string" && input.trim()) {
      chosenItem = input.trim();
    } else if (input && typeof input === "object" && input.item) {
      chosenItem = input.item.trim();
    }
  });

  setHandler(rejectSignal, () => {
    decision = "rejected";
  });

  // Pauses workflow execution until an approve or reject signal arrives.
  await condition(() => decision !== null);

  // If rejected, stop here.
  if (decision === "rejected") {
    return {
      status: "rejected",
      inventory: inventoryResult,
      message: "Workflow was rejected. No items were added to the cart.",
    };
  }

  // 3. On approval, add chosen item (defaulting to the first item) to cart and screenshot.
  const targetItem =
    chosenItem || inventoryResult.products[0]?.name || "Sauce Labs Backpack";
  const cartResult = await addToCart(targetItem);

  return {
    status: "approved",
    inventory: inventoryResult,
    cart: cartResult,
    message: `Workflow approved. Added '${targetItem}' to cart and took screenshot.`,
  };
}

