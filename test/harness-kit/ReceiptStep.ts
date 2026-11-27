import { Inject } from "@asenajs/ioc";
import { type After, FlowStep, FlowStepBase } from "../../src/harness-kit/index.ts";
import { OrderBook } from "./OrderBook.ts";
import type { OrderWorkflow } from "./OrderWorkflow.ts";
import type { ShopInput } from "./types/workflow.ts";

@FlowStep({ name: "receipt", description: "Writes what the customer owes the shop." })
export class ReceiptStep extends FlowStepBase {
  @Inject(OrderBook)
  private readonly book!: OrderBook;

  public execute(state: ShopInput & After<typeof OrderWorkflow>) {
    this.book.ran.push(`${this.name}:${Object.keys(state).sort().join(",")}`);

    return { receipt: `${state.shop}: ${state.customer} owes ${state.total} (${state.note})` };
  }
}
