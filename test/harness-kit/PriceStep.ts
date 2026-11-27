import { Inject } from "@asenajs/ioc";
import { type After, FlowStep, FlowStepBase } from "../../src/harness-kit/index.ts";
import type { ItemsStep } from "./ItemsStep.ts";
import { OrderBook } from "./OrderBook.ts";

@FlowStep({ name: "price", description: "Looks up the price of every item." })
export class PriceStep extends FlowStepBase {
  @Inject(OrderBook)
  private readonly book!: OrderBook;

  public execute(state: After<typeof ItemsStep>) {
    this.book.ran.push(this.name);

    const prices = state.items.map((item) => {
      const price = this.book.prices[item];

      if (price === undefined) throw new RangeError(`no price for ${item}`);

      return price;
    });

    return { prices };
  }
}
