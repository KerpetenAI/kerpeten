import { Inject } from "@asenajs/ioc";
import { FlowStep, FlowStepBase } from "../../src/harness-kit/index.ts";
import { OrderBook } from "./OrderBook.ts";
import type { OrderInput } from "./types/workflow.ts";

@FlowStep({ name: "items", description: "Counts the items of the order and ends an empty order." })
export class ItemsStep extends FlowStepBase {
  @Inject(OrderBook)
  private readonly book!: OrderBook;

  public async execute(state: OrderInput) {
    this.book.ran.push(this.name);

    if (state.items.length === 0) return this.end({ total: 0, note: "empty" });

    return { count: state.items.length };
  }
}
