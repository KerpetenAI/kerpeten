import { Service } from "@asenajs/ioc";

/** The prices the order flow steps read, and the names of the flow steps that ran, in order. */
@Service("test:order-book")
export class OrderBook {
  public readonly prices: Readonly<Record<string, number>> = { apple: 2, pear: 3, plum: 5 };

  public readonly ran: string[] = [];
}
