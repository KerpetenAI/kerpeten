import { Harness } from "../../src/harness-kit/index.ts";
import { OptionalSearchTool } from "./OptionalSearchTool.ts";
import { TestHarness } from "./TestHarness.ts";

@Harness({ name: "test-optional", tools: [OptionalSearchTool], permissions: ["repo:read", "repo:search"] })
export class OptionalTestHarness extends TestHarness {}
