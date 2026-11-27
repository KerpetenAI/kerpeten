import { type After, Workflow, WorkflowBase } from "../../src/harness-kit/index.ts";
import { DiscountStep } from "./DiscountStep.ts";
import { ItemsStep } from "./ItemsStep.ts";
import { PriceStep } from "./PriceStep.ts";
import { TotalStep } from "./TotalStep.ts";
import type { OrderInput, OrderResult } from "./types/workflow.ts";

@Workflow({
  name: "order",
  description: "Prices an order of items.",
  steps: [ItemsStep, PriceStep, DiscountStep, TotalStep],
})
export class OrderWorkflow extends WorkflowBase<OrderInput, After<typeof TotalStep>, OrderResult> {
  protected finish(state: After<typeof TotalStep>): OrderResult {
    return { total: state.total, note: state.discount === undefined ? "full price" : state.discount.reason };
  }
}
