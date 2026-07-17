import {
  getUnfilteredModels,
  isRegistryPatched,
  patchRegistry,
  type PatchedRegistry,
  unpatchRegistry,
} from "../../src/model-filter.js";
import type { HideRule } from "../../src/index.js";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

const models = [
  { provider: "visible", id: "one" },
  { provider: "hidden", id: "two" },
];

describe("model filtering patches", () => {
  it("patches ModelRuntime because current pi bypasses ModelRegistry", async () => {
    const runtime = {
      getModels: () => models,
      getAvailableSnapshot: () => models,
      getAvailable: async () => models,
      getModel: (provider: string, id: string) =>
        models.find((model) => model.provider === provider && model.id === id),
    };
    const registry: PatchedRegistry = {
      runtime,
      getAll: () => [...runtime.getModels()],
      getAvailable: () => [...runtime.getAvailableSnapshot()],
      find: (provider, id) => runtime.getModel(provider, id),
    };
    let rules: HideRule[] = [{ provider: "hidden" }];

    patchRegistry(registry, () => rules);

    expect(runtime.getModels()).toEqual([models[0]]);
    expect(runtime.getAvailableSnapshot()).toEqual([models[0]]);
    expect(await runtime.getAvailable()).toEqual([models[0]]);
    expect(runtime.getModel("hidden", "two")).toBeUndefined();
    expect(registry.getAll()).toEqual([models[0]]);
    expect(getUnfilteredModels(registry)).toEqual(models);
    expect(isRegistryPatched(registry)).toBe(true);

    rules = [];
    expect(runtime.getModels()).toEqual(models);

    unpatchRegistry(registry);
    expect(runtime.getModels()).toEqual(models);
    expect(isRegistryPatched(registry)).toBe(false);
  });

  it("filters the real pi 0.80 ModelRuntime behind ModelRegistry", async () => {
    const runtime = await ModelRuntime.create({
      allowModelNetwork: false,
      modelsPath: null,
    });
    const registry = new ModelRegistry(runtime) as unknown as PatchedRegistry;
    const allModels = runtime.getModels();
    const hiddenProvider = allModels[0]?.provider;
    expect(hiddenProvider).toBeDefined();

    try {
      patchRegistry(registry, () => [{ provider: hiddenProvider! }]);

      expect(runtime.getModels().some((model) => model.provider === hiddenProvider)).toBe(false);
      expect(getUnfilteredModels(registry)).toHaveLength(allModels.length);
    } finally {
      unpatchRegistry(registry);
    }

    expect(runtime.getModels()).toHaveLength(allModels.length);
  });

  it("falls back to patching ModelRegistry on older pi versions", () => {
    const registry: PatchedRegistry = {
      getAll: () => models,
      getAvailable: () => models,
      find: (provider, id) =>
        models.find((model) => model.provider === provider && model.id === id),
    };

    patchRegistry(registry, () => [{ provider: "hidden" }]);

    expect(registry.getAll()).toEqual([models[0]]);
    expect(registry.getAvailable()).toEqual([models[0]]);
    expect(registry.find("hidden", "two")).toBeUndefined();
    expect(getUnfilteredModels(registry)).toEqual(models);

    unpatchRegistry(registry);
    expect(registry.getAll()).toEqual(models);
  });
});
