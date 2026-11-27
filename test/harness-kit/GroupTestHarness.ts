import { Harness } from "../../src/harness-kit/index.ts";
import { FakeGrepTool } from "./FakeGrepTool.ts";
import { FakeListTool } from "./FakeListTool.ts";
import { TestHarness } from "./TestHarness.ts";

@Harness({ name: "test-groups", tools: [FakeListTool, FakeGrepTool], permissions: ["repo:read", "repo:search"] })
export class GroupTestHarness extends TestHarness {}
