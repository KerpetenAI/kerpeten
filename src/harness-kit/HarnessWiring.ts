import { capabilitySpec } from "./capability/Capability.decorator.ts";
import type { PermissionGrant } from "./capability/types/capability.ts";
import { harnessSpec } from "./Harness.decorator.ts";
import { grants } from "./harness-kit-utils.ts";
import { PermissionGroupError } from "./PermissionGroupError.ts";
import { toolSpec } from "./Tool.decorator.ts";
import type { HarnessClass, HarnessSpec } from "./types/harness.ts";
import type { DeclaredGroups, OptionalGap, PermissionNeed } from "./types/wiring.ts";
import { UnmarkedClassError } from "./UnmarkedClassError.ts";
import { WiringError } from "./WiringError.ts";

/**
 * Checks harnesses, their tools, the capabilities those tools use and the permission groups against each other: once
 * at startup (`check`), and when a workflow starts, the harnesses it reaches against the run's grant (`admit`).
 */
export class HarnessWiring {
  public static check(harnesses: readonly HarnessClass[], groups: DeclaredGroups): void {
    const problems = HarnessWiring.problems(harnesses, groups);

    if (problems.length > 0) throw new WiringError(problems);
  }

  public static problems(harnesses: readonly HarnessClass[], groups: DeclaredGroups): readonly string[] {
    const problems = new Set<string>();
    const names = new Set<string>();
    const twice = new Set<string>();
    const listed = new Set<string>();

    for (const [index, harness] of harnesses.entries()) {
      if (harness === undefined) {
        problems.add(`the harness list holds nothing at entry ${index + 1}, which is likely an import cycle`);
        continue;
      }

      const spec = HarnessWiring.find(() => harnessSpec(harness));

      if (spec === undefined) {
        problems.add(`the harness list holds ${harness.name}, which is not marked with @Harness`);
        continue;
      }

      if (names.has(spec.name)) twice.add(`two harnesses are named ${spec.name}`);

      names.add(spec.name);

      for (const permission of spec.permissions) listed.add(permission);

      for (const problem of HarnessWiring.harnessProblems(spec)) problems.add(problem);
    }

    for (const problem of twice) problems.add(problem);

    for (const [group, permissions] of groups.declared) {
      for (const permission of permissions) {
        if (!listed.has(permission))
          problems.add(`permission group ${group} lists the permission ${permission}, which no harness lists`);
      }
    }

    return [...problems];
  }

  /** Every `@Use` of the harness's tools, in the order of its tools. */
  public static needs(harness: HarnessClass): readonly PermissionNeed[] {
    const spec = harnessSpec(harness);
    const needs: PermissionNeed[] = [];

    for (const tool of spec.tools.map((toolClass) => toolSpec(toolClass))) {
      for (const use of tool.uses) {
        const capability = capabilitySpec(use.capability);

        if (capability.permission === undefined) continue;

        needs.push({
          harness: spec.name,
          tool: tool.name,
          capability: capability.name,
          permission: capability.permission,
          required: use.required,
        });
      }
    }

    return needs;
  }

  /** The permissions a run of the harness cannot start without: those of its tools' required uses. */
  public static required(harness: HarnessClass): readonly string[] {
    return [
      ...new Set(
        HarnessWiring.needs(harness)
          .filter((need) => need.required)
          .map((need) => need.permission),
      ),
    ];
  }

  /** The permissions the harness lists that the grant gives. */
  public static given(harness: HarnessClass, grant: PermissionGrant): readonly string[] {
    return harnessSpec(harness).permissions.filter((permission) => grants(grant, permission));
  }

  /**
   * Refuses a grant that misses a required permission of any of the harnesses, and returns the optional uses it does
   * not give.
   */
  public static admit(harnesses: readonly HarnessClass[], grant: PermissionGrant): readonly OptionalGap[] {
    const missing = new Set<string>();
    const gaps: OptionalGap[] = [];

    for (const harness of harnesses) {
      const required: ReadonlySet<string> = new Set(HarnessWiring.required(harness));

      for (const need of HarnessWiring.needs(harness)) {
        if (grants(grant, need.permission)) continue;

        if (required.has(need.permission)) {
          missing.add(`- harness ${need.harness} needs the permission ${need.permission}`);
          continue;
        }

        const { harness: name, tool, capability, permission } = need;

        gaps.push({ harness: name, tool, capability, permission, group: grant.group });
      }
    }

    if (missing.size > 0) {
      throw new PermissionGroupError(
        [`the permission group ${JSON.stringify(grant.group)} cannot start this run:`, ...missing].join("\n"),
      );
    }

    return gaps;
  }

  private static harnessProblems(spec: HarnessSpec): readonly string[] {
    const missing: string[] = [];
    const twice: string[] = [];
    const unmarked: string[] = [];
    const capabilities: string[] = [];
    const names = new Set<string>();
    const used = new Set<string>();

    for (const [index, tool] of spec.tools.entries()) {
      if (tool === undefined) {
        unmarked.push(
          `harness ${spec.name} holds nothing at entry ${index + 1} of its tools, which is likely an import cycle`,
        );

        continue;
      }

      const marked = HarnessWiring.find(() => toolSpec(tool));

      if (marked === undefined) {
        unmarked.push(`harness ${spec.name} lists ${tool.name}, which is not marked with @Tool`);
        continue;
      }

      if (names.has(marked.name)) twice.push(`harness ${spec.name} has two tools named ${marked.name}`);

      names.add(marked.name);

      for (const use of marked.uses) {
        const capability = HarnessWiring.find(() => capabilitySpec(use.capability));

        if (capability === undefined) {
          capabilities.push(
            `tool ${marked.name} uses ${use.capability.name} in its field ${use.field}, which is not marked with @Capability`,
          );

          continue;
        }

        if (capability.permission === undefined) {
          capabilities.push(`tool ${marked.name} uses the capability ${capability.name}, which declares no permission`);
          continue;
        }

        used.add(capability.permission);

        if (!spec.permissions.includes(capability.permission))
          missing.push(
            `harness ${spec.name} does not list the permission ${capability.permission}, which its tool ${marked.name} needs`,
          );
      }
    }

    const unused = spec.permissions
      .filter((permission) => !used.has(permission))
      .map((permission) => `harness ${spec.name} lists the permission ${permission}, which none of its tools uses`);

    return [...missing, ...twice, ...unmarked, ...capabilities, ...unused];
  }

  private static find<T>(read: () => T): T | undefined {
    try {
      return read();
    } catch (error) {
      if (error instanceof UnmarkedClassError) return undefined;

      throw error;
    }
  }
}
