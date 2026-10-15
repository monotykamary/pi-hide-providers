import {
  getUnfilteredModels,
  installRuntimePrototypePatch,
  isRegistryPatched,
  patchRegistry,
  suspendPrototypeFilters,
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

describe("runtime prototype patch", () => {
  const makeRuntimeClass = () =>
    class {
      getModels() {
        return models;
      }
      getAvailableSnapshot() {
        return models;
      }
      async getAvailable() {
        return models;
      }
      getModel(provider: string, id: string) {
        return models.find((model) => model.provider === provider && model.id === id);
      }
    };

  it("filters accessors before session_start fires", async () => {
    const RuntimeClass = makeRuntimeClass();
    const dispose = installRuntimePrototypePatch(RuntimeClass, () => [{ provider: "hidden" }]);
    expect(dispose).toBeTypeOf("function");

    const runtime = new RuntimeClass();

    try {
      expect(runtime.getModels()).toEqual([models[0]]);
      expect(runtime.getAvailableSnapshot()).toEqual([models[0]]);
      expect(await runtime.getAvailable()).toEqual([models[0]]);
      expect(runtime.getModel("hidden", "two")).toBeUndefined();
      expect(runtime.getModel("visible", "one")).toEqual(models[0]);
    } finally {
      dispose?.();
    }

    expect(runtime.getModels()).toEqual(models);
  });

  it("updates rules instead of stacking when installed twice", async () => {
    const RuntimeClass = makeRuntimeClass();
    let rules: HideRule[] = [{ provider: "hidden" }];
    const dispose = installRuntimePrototypePatch(RuntimeClass, () => rules);
    installRuntimePrototypePatch(RuntimeClass, () => rules);

    const runtime = new RuntimeClass();

    try {
      expect(runtime.getModels()).toEqual([models[0]]);

      rules = [{ provider: "visible" }];
      expect(runtime.getModels()).toEqual([models[1]]);
    } finally {
      dispose?.();
    }
  });

  it("suspends for /hide-models reset and resumes on patchRegistry", async () => {
    const RuntimeClass = makeRuntimeClass();
    const dispose = installRuntimePrototypePatch(RuntimeClass, () => [{ provider: "hidden" }]);
    const runtime = new RuntimeClass();
    const registry: PatchedRegistry = {
      runtime,
      getAll: () => [...runtime.getModels()],
      getAvailable: () => [...runtime.getAvailableSnapshot()],
      find: (provider, id) => runtime.getModel(provider, id),
    };

    try {
      expect(runtime.getModels()).toEqual([models[0]]);

      suspendPrototypeFilters();
      expect(runtime.getModels()).toEqual(models);

      // Any instance patch application resumes prototype filtering.
      patchRegistry(registry, () => [{ provider: "hidden" }]);
      expect(runtime.getModels()).toEqual([models[0]]);
      expect(getUnfilteredModels(registry)).toEqual(models);
    } finally {
      unpatchRegistry(registry);
      dispose?.();
    }
  });

  it("keeps getUnfilteredModels unfiltered under instance patches on top", async () => {
    const RuntimeClass = makeRuntimeClass();
    const dispose = installRuntimePrototypePatch(RuntimeClass, () => [{ provider: "hidden" }]);
    const runtime = new RuntimeClass();
    const registry: PatchedRegistry = {
      runtime,
      getAll: () => [...runtime.getModels()],
      getAvailable: () => [...runtime.getAvailableSnapshot()],
      find: (provider, id) => runtime.getModel(provider, id),
    };

    try {
      patchRegistry(registry, () => [{ provider: "hidden" }]);
      expect(runtime.getModels()).toEqual([models[0]]);
      expect(getUnfilteredModels(registry)).toEqual(models);
    } finally {
      unpatchRegistry(registry);
      dispose?.();
    }
  });

  it("filters the real pi ModelRuntime prototype", async () => {
    const runtime = await ModelRuntime.create({
      allowModelNetwork: false,
      modelsPath: null,
    });
    const allModels = runtime.getModels();
    const hiddenProvider = allModels[0]?.provider;
    expect(hiddenProvider).toBeDefined();

    const dispose = installRuntimePrototypePatch(ModelRuntime, () => [{ provider: hiddenProvider! }]);
    expect(dispose).toBeTypeOf("function");

    try {
      expect(runtime.getModels().some((model) => model.provider === hiddenProvider)).toBe(false);
      expect(runtime.getModel(hiddenProvider!, allModels[0]!.id)).toBeUndefined();
    } finally {
      dispose?.();
    }

    expect(runtime.getModels()).toHaveLength(allModels.length);
  });

  it("returns undefined for classes without a prototype", () => {
    expect(installRuntimePrototypePatch(undefined, () => [])).toBeUndefined();
    expect(installRuntimePrototypePatch(null, () => [])).toBeUndefined();
  });
});
