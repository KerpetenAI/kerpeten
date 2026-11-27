import { type After, Workflow, WorkflowBase } from "../../src/harness-kit/index.ts";
import { OrderWorkflow } from "./OrderWorkflow.ts";
import { ReceiptStep } from "./ReceiptStep.ts";
import type { ShopInput, ShopResult } from "./types/workflow.ts";

@Workflow({
  name: "shop",
  description: "Prices an order and writes its receipt.",
  steps: [OrderWorkflow, ReceiptStep],
})
export class ShopWorkflow extends WorkflowBase<ShopInput, After<typeof ReceiptStep>, ShopResult> {
  protected finish(state: After<typeof ReceiptStep>): ShopResult {
    return { receipt: state.receipt };
  }
}
