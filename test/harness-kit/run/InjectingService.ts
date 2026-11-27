import { Inject, Service } from "@asenajs/ioc";
import type { CountedService } from "./CountedService.ts";

/** A singleton that takes a run component with `@Inject` instead of `@Use`. */
@Service("test:injecting")
export class InjectingService {
  @Inject("test:counted")
  public readonly counted!: CountedService;
}
