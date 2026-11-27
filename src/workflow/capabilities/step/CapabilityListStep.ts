import { Inject } from "@asenajs/ioc";
import {
  CapabilityRegistry,
  FlowStep,
  FlowStepBase,
  HarnessRegistry,
  harnessSpec,
  type KitInstances,
  KitNames,
  PermissionGroupSet,
} from "../../../harness-kit/index.ts";

/** Prints the capabilities of this build, the permission groups and the permissions each harness lists. */
@FlowStep({
  name: "capability-list",
  description: "Prints the capabilities of this build, the permission groups and the permissions each harness lists.",
})
export class CapabilityListStep extends FlowStepBase {
  @Inject(KitNames.IO)
  private readonly io!: KitInstances[KitNames.IO];

  @Inject(KitNames.PERMISSION_GROUPS)
  private readonly groups!: KitInstances[KitNames.PERMISSION_GROUPS];

  @Inject(CapabilityRegistry)
  private readonly capabilities!: CapabilityRegistry;

  @Inject(HarnessRegistry)
  private readonly registry!: HarnessRegistry;

  public execute(_state: object) {
    const { io } = this;

    for (const spec of this.capabilities.specs) {
      io.out(spec.permission === undefined ? spec.name : `${spec.name} (permission: ${spec.permission})`);
      io.out(`    ${spec.description}`);
    }

    io.out("");
    io.out("permission groups");
    io.out(`    ${PermissionGroupSet.ALL}: every permission`);

    for (const [name, permissions] of this.groups.declared) io.out(`    ${name}: ${permissions.join(", ")}`);

    io.out("");
    io.out("harnesses");

    for (const harness of this.registry.harnesses) {
      const { name, permissions } = harnessSpec(harness);

      io.out(`    ${name}: ${permissions.join(", ")}`);
    }

    return {};
  }
}
