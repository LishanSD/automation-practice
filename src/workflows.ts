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

export type WorkflowOptions = {
  username?: string;
  simulateFirstAttemptFailure?: boolean;
  activityTimeout?: string;
  maxAttempts?: number;
};

export async function inventoryWorkflow(
  options?: WorkflowOptions
): Promise<WorkflowResult> {
  // Configure activities' timeout and retry policy:
  // - startToCloseTimeout: Limits how long a single attempt can take (e.g. "3s" for slow-page timeout demo).
  // - retry.initialInterval: "1s" delay before first retry attempt.
  // - retry.maximumAttempts: Allows up to 3 attempts.
  // - retry.nonRetryableErrorTypes: Ensures LockedOutUserError is never retried.
  const { readInventory, addToCart } = proxyActivities<typeof activities>({
    startToCloseTimeout: options?.activityTimeout ?? "2 minutes",
    retry: {
      initialInterval: "1s",
      backoffCoefficient: 2,
      maximumAttempts: options?.maxAttempts ?? 3,
      nonRetryableErrorTypes: ["LockedOutUserError", "MissingApiKeyError"],
    },
  });

  // 1. The workflow delegates reading inventory to the first activity.
  const inventoryResult = await readInventory({
    username: options?.username,
    simulateFirstAttemptFailure: options?.simulateFirstAttemptFailure,
  });

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
  const cartResult = await addToCart(targetItem, options?.username);

  return {
    status: "approved",
    inventory: inventoryResult,
    cart: cartResult,
    message: `Workflow approved. Added '${targetItem}' to cart and took screenshot.`,
  };
}

