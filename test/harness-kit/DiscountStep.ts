import { Inject } from "@asenajs/ioc";
import { type After, FlowStep, FlowStepBase } from "../../src/harness-kit/index.ts";
import { OrderBook } from "./OrderBook.ts";
import type { PriceStep } from "./PriceStep.ts";

@FlowStep({ name: "discount", description: "Takes half off an order of three or more items." })
export class DiscountStep extends FlowStepBase {
  @Inject(OrderBook)
  private readonly book!: OrderBook;

  public async execute(state: After<typeof PriceStep>) {
    this.book.ran.push(this.name);

    if (state.count < 3) return { discount: undefined };

    return { discount: { rate: 0.5, reason: `${state.count} items` } };
  }
}
