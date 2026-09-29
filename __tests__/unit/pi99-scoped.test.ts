import { expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ModelSelectorComponent } from "@earendil-works/pi-coding-agent";
import extension from "../../hide-providers.js";

it("filters native unavailable scoped fallbacks and restores on shutdown/restart", async () => {
  const root = resolve(".tmp/pi99-scoped"); mkdirSync(root + "/.pi", { recursive: true });
  writeFileSync(root + "/.pi/hide-providers.json", JSON.stringify({ hide: [{ provider: "hidden" }] }));
  const handlers = new Map<string, any>();
  extension({ on: (n: string, f: any) => handlers.set(n, f), registerCommand() {} } as any);
  const model = { provider: "hidden", id: "m" };
  const registry = { getAll: () => [model], getAvailable: () => [model], find: () => model };
  const ctx = { cwd: root, mode: "tui", modelRegistry: registry };
  const proto = ModelSelectorComponent.prototype as any; const original = proto.loadModelsFromSnapshot;
  try {
    for (let i = 0; i < 2; i++) {
      await handlers.get("session_start")({}, ctx);
      const selector = Object.assign(Object.create(proto), { modelRuntime: { getAvailableSnapshot: () => [], getModel: () => undefined }, scopedModels: [{ model }], scope: "scoped", selectedIndex: 0 });
      selector.loadModelsFromSnapshot();
      expect(selector.scopedModelItems).toEqual([]);
      expect(selector.scopedModels).toEqual([{ model }]);
      await handlers.get("session_shutdown")();
      expect(proto.loadModelsFromSnapshot).toBe(original);
      expect(registry.getAll()).toEqual([model]);
    }
  } finally { await handlers.get("session_shutdown")(); rmSync(root, { recursive: true, force: true }); }
});
