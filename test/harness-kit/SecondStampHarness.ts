import { Harness } from "../../src/harness-kit/index.ts";
import { StampTool } from "./StampTool.ts";
import { TestHarness } from "./TestHarness.ts";

@Harness({ name: "second-stamper", tools: [StampTool], permissions: ["marker:read", "repo:search"] })
export class SecondStampHarness extends TestHarness {}
