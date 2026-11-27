import { describe, expect, test } from "bun:test";
import { type Class, IocApplication } from "@asenajs/ioc";
import {
  type After,
  flowStepSpec,
  KitNames,
  PermissionGroupSet,
  RunScope,
  registeredName,
  WiringError,
  WorkflowEnd,
  WorkflowRegistry,
  workflowSpec,
} from "../../src/harness-kit/index.ts";
import { DiscountStep } from "./DiscountStep.ts";
import { errorChain, quietLogger, typeErrors } from "./harness-kit-utils.ts";
import { ItemsStep } from "./ItemsStep.ts";
import { OrderBook } from "./OrderBook.ts";
import { OrderWorkflow } from "./OrderWorkflow.ts";
import { PriceStep } from "./PriceStep.ts";
import { ReceiptStep } from "./ReceiptStep.ts";
import { ShopWorkflow } from "./ShopWorkflow.ts";
import { TotalStep } from "./TotalStep.ts";
import { UnmarkedStep } from "./UnmarkedStep.ts";
import { UnmarkedWorkflow } from "./UnmarkedWorkflow.ts";

const COMPONENTS: readonly Class[] = [
  WorkflowRegistry,
  OrderBook,
  ItemsStep,
  PriceStep,
  DiscountStep,
  TotalStep,
  ReceiptStep,
  OrderWorkflow,
  ShopWorkflow,
];

async function created(components: readonly Class[]): Promise<IocApplication> {
  return IocApplication.create({
    components: [...components],
    instances: { [KitNames.PERMISSION_GROUPS]: new PermissionGroupSet({}) },
    logger: quietLogger(),
  });
}

/**
 * A started container of the order components and what the tests take from it. After the start only a run's build
 * resolves, and only its run components; any other resolve throws.
 */
async function shop() {
  const app = await created(COMPONENTS);

  await app.start();

  const taken = {
    app,
    book: await app.resolve(OrderBook),
    order: await app.resolve(OrderWorkflow),
    shop: await app.resolve(ShopWorkflow),
    items: await app.resolve(ItemsStep),
    total: await app.resolve(TotalStep),
  };

  const resolve = app.container.resolve;

  app.container.resolve = function <T>(this: typeof app.container, key: string) {
    if (RunScope.building() === undefined) {
      throw new Error(`only a run's build resolves after the start, and only its run components, not ${key}`);
    }

    return resolve.call(this, key) as Promise<T>;
  };

  return taken;
}

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }

  throw new Error("it did not fail");
}

const IMPORTS = [
  'import { type After, FlowStep, FlowStepBase, Workflow, WorkflowBase } from "../../src/harness-kit/index.ts";',
  'import { DiscountStep } from "./DiscountStep.ts";',
  'import { ItemsStep } from "./ItemsStep.ts";',
  'import { PriceStep } from "./PriceStep.ts";',
  'import { TotalStep } from "./TotalStep.ts";',
  'import type { Discount, OrderInput, OrderResult, ShopResult } from "./types/workflow.ts";',
  "",
];

function order(steps: string, result = "OrderResult"): string {
  return [
    ...IMPORTS,
    `@Workflow({ name: "order", description: "Prices an order.", steps: [${steps}] })`,
    `export class Probe extends WorkflowBase<OrderInput, After<typeof TotalStep>, ${result}> {`,
    `  protected finish(state: After<typeof TotalStep>): ${result} {`,
    `    return ${result === "ShopResult" ? "{ receipt: String(state.total) }" : '{ total: state.total, note: "" }'};`,
    "  }",
    "}",
    "",
  ].join("\n");
}

function step(expression: string): string {
  return [
    ...IMPORTS,
    '@FlowStep({ name: "probe", description: "Reads the state." })',
    "export class Probe extends FlowStepBase {",
    "  public execute(state: After<typeof DiscountStep>) {",
    `    return { probe: ${expression} };`,
    "  }",
    "}",
    "",
  ].join("\n");
}

const DECORATOR_LINE = IMPORTS.length + 1;

describe("WorkflowBase", () => {
  test("runs the flow steps in order and each flow step sees the fields the earlier ones added", async () => {
    const { order, book } = await shop();

    const result = await order.run({ customer: "Ada", items: ["apple", "pear", "plum"] });

    expect(result).toEqual({ total: 5, note: "3 items" });
    expect(book.ran).toEqual(["items", "price", "discount", "total"]);
  });

  test("a field one path leaves undefined reaches the next flow step as undefined", async () => {
    const { order } = await shop();

    const result = await order.run({ customer: "Ada", items: ["apple", "pear"] });

    expect(result).toEqual({ total: 5, note: "full price" });
  });

  test("this.end(result) ends the run with that result and the later flow steps and finish do not run", async () => {
    const { order, book } = await shop();

    const result = await order.run({ customer: "Ada", items: [] });

    expect(result).toEqual({ total: 0, note: "empty" });
    expect(book.ran).toEqual(["items"]);
  });

  test("an error a flow step throws passes through unchanged and stops the run", async () => {
    const { order, book } = await shop();

    const run = order.run({ customer: "Ada", items: ["apple", "boom"] });

    await expect(run).rejects.toBeInstanceOf(RangeError);
    await expect(run).rejects.toThrow("no price for boom");
    expect(book.ran).toEqual(["items", "price"]);
  });

  test("a nested workflow runs as a flow step, and only the fields of its result join the outer state", async () => {
    const { shop: workflow, book } = await shop();

    const result = await workflow.run({ shop: "Corner", customer: "Bo", items: ["apple", "pear"] });

    expect(result).toEqual({ receipt: "Corner: Bo owes 5 (full price)" });

    expect(book.ran).toEqual(["items", "price", "discount", "total", "receipt:customer,items,note,shop,total"]);
  });

  test("an early end inside a nested workflow does not stop the outer chain", async () => {
    const { shop: workflow, book } = await shop();

    const result = await workflow.run({ shop: "Corner", customer: "Bo", items: [] });

    expect(result).toEqual({ receipt: "Corner: Bo owes 0 (empty)" });
    expect(book.ran).toEqual(["items", "receipt:customer,items,note,shop,total"]);
  });

  test("a flow step runs alone: execute takes the state and returns only its additions", async () => {
    const { items, total } = await shop();

    const state: After<typeof DiscountStep> = {
      customer: "Ada",
      items: ["apple"],
      count: 1,
      prices: [4],
      discount: { rate: 0.25, reason: "test" },
    };

    expect(total.execute(state)).toEqual({ total: 3 });

    expect(await items.execute({ customer: "Ada", items: [] })).toEqual(new WorkflowEnd({ total: 0, note: "empty" }));
  });

  test("the specs give the name, the description and the flow step order without building anything", () => {
    expect(flowStepSpec(PriceStep)).toEqual({ name: "price", description: "Looks up the price of every item." });

    expect(workflowSpec(OrderWorkflow)).toEqual({
      name: "order",
      description: "Prices an order of items.",
      steps: [ItemsStep, PriceStep, DiscountStep, TotalStep],
    });

    expect(workflowSpec(ShopWorkflow).steps).toEqual([OrderWorkflow, ReceiptStep]);
  });

  test("the decorators register flow steps as flow-step:<name> and workflows as workflow:<name>, and the instances carry their names", async () => {
    const { app, shop: workflow, total } = await shop();

    expect(registeredName(app.container, PriceStep)).toBe("flow-step:price");
    expect(registeredName(app.container, OrderWorkflow)).toBe("workflow:order");
    expect(total.name).toBe("total");
    expect(workflow.name).toBe("shop");
  });

  test("a class not marked with @FlowStep or @Workflow has no spec", () => {
    expect(() => new UnmarkedStep()).toThrow("the class is not marked with @FlowStep");
    expect(() => new UnmarkedWorkflow()).toThrow("the class is not marked with @Workflow");
  });
});

describe("workflows in the container", () => {
  test("a flow step a workflow lists that is not registered in the container stops the start", async () => {
    const app = await created(COMPONENTS.filter((component) => component !== PriceStep));
    const error = await failure(() => app.start());

    expect(errorChain(error)).toEqual([
      "@OnStart hook 'WorkflowRegistry.assemble()' failed",
      "the harness wiring is wrong:\n- workflow order lists PriceStep, which is not registered in the container",
    ]);

    expect((error as Error).cause).toBeInstanceOf(WiringError);
  });

  test("a flow step that injects something not registered in the container stops the start", async () => {
    const error = await failure(() => created([WorkflowRegistry, ItemsStep]));

    expect(errorChain(error)).toEqual([
      "'test:order-book' is not registered (injected into ItemsStep.book)",
      "test:order-book is not registered",
    ]);
  });

  test("a workflow is given its flow steps once, and without the registry it refuses to run", async () => {
    const app = await created(COMPONENTS.filter((component) => component !== WorkflowRegistry));

    await app.start();

    const workflow = await app.resolve(OrderWorkflow);

    await expect(workflow.run({ customer: "Ada", items: [] })).rejects.toThrow(
      "the workflow order has no flow steps; the WorkflowRegistry gives them when the container starts",
    );

    workflow.bind([]);

    expect(() => workflow.bind([])).toThrow("the workflow order already has its flow steps");
  });
});

describe("@Workflow at compile time", () => {
  test("accepts a valid chain and rejects a wrong order, a missing flow step and a field added twice on the decorator line", async () => {
    const errors = await typeErrors({
      "probe-valid.ts": order("ItemsStep, PriceStep, DiscountStep, TotalStep"),
      "probe-order.ts": order("PriceStep, ItemsStep, DiscountStep, TotalStep"),
      "probe-missing.ts": order("ItemsStep, PriceStep, TotalStep"),
      "probe-twice.ts": order("ItemsStep, PriceStep, PriceStep, DiscountStep, TotalStep"),
      "probe-final.ts": order("ItemsStep, PriceStep, DiscountStep"),
      "probe-end.ts": order("ItemsStep, PriceStep, DiscountStep, TotalStep", "ShopResult"),
    });

    expect(errors.map(({ file, line, code }) => ({ file, line, code }))).toEqual(
      ["order", "missing", "twice", "final", "end"].map((name) => ({
        file: `probe-${name}.ts`,
        line: DECORATOR_LINE,
        code: 1238,
      })),
    );

    const texts = Object.fromEntries(errors.map((error) => [error.file, error.text]));

    expect(texts["probe-order.ts"]).toContain("'FlowStepNeedsMore<typeof PriceStep, \"count\">'");
    expect(texts["probe-missing.ts"]).toContain("'FlowStepNeedsMore<typeof TotalStep, \"discount\">'");
    expect(texts["probe-twice.ts"]).toContain("'FlowStepAddsTwice<typeof PriceStep, \"prices\">'");
    expect(texts["probe-final.ts"]).toContain("'NoStepAdds<\"total\">'");
    expect(texts["probe-end.ts"]).toContain("'FlowStepEndsWithOtherResult<typeof ItemsStep>'");
  }, 60_000);

  test("a flow step sees the inferred fields of the earlier flow steps and nothing else", async () => {
    const errors = await typeErrors({
      "probe-inferred.ts": step(
        "[state.customer, state.count, state.prices, state.discount] satisfies [string, number, readonly number[], Discount | undefined]",
      ),
      "probe-typo.ts": step("state.price"),
      "probe-later.ts": step("state.total"),
    });

    expect(errors.map(({ file, code }) => ({ file, code }))).toEqual([
      { file: "probe-typo.ts", code: 2551 },
      { file: "probe-later.ts", code: 2339 },
    ]);

    expect(errors[0]?.text).toContain("Property 'price' does not exist on type 'After<typeof DiscountStep>'");
    expect(errors[0]?.text).toContain("Did you mean 'prices'?");
    expect(errors[1]?.text).toContain("Property 'total' does not exist on type 'After<typeof DiscountStep>'");
  }, 60_000);
});
