import { Inject } from "@asenajs/ioc";
import { type After, FlowStep, FlowStepBase } from "../../src/harness-kit/index.ts";
import type { DiscountStep } from "./DiscountStep.ts";
import { OrderBook } from "./OrderBook.ts";

@FlowStep({ name: "total", description: "Adds up the prices and takes off the discount." })
export class TotalStep extends FlowStepBase {
  @Inject(OrderBook)
  private readonly book!: OrderBook;

  public execute(state: After<typeof DiscountStep>) {
    this.book.ran.push(this.name);

    const sum = state.prices.reduce((total, price) => total + price, 0);

    return { total: sum * (1 - (state.discount?.rate ?? 0)) };
  }
}
