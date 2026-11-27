import { RunService } from "../../../src/harness-kit/index.ts";
import { TwinSource } from "./TwinSource.ts";

@RunService("test:twin")
export class TwinSourceDouble extends TwinSource {}
