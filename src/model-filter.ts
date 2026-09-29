import { isHidden, type HideRule } from "./index.js";
import { installMethodPatch } from "./method-patch.js";

interface ModelRuntimeLike {
  getModels(providerId?: string): readonly unknown[];
  getAvailableSnapshot(): readonly unknown[];
  getAvailable?(providerId?: string, options?: any): Promise<readonly unknown[]>;
  getModel(provider: string, modelId: string): unknown | undefined;
}
export interface PatchedRegistry {
  runtime?: ModelRuntimeLike;
  getAvailable(): unknown[];
  getAll(): unknown[];
  find(provider: string, modelId: string): unknown | undefined;
}
interface PatchState {
  getRules: () => HideRule[];
  all: () => readonly unknown[];
  restores: Array<() => void>;
}
const patches = new WeakMap<object, PatchState>();
function target(registry: PatchedRegistry) { return registry.runtime ?? registry; }
function filter(models: readonly unknown[], rules: HideRule[]): unknown[] {
  return models.filter((model) => {
    const { provider, id } = model as { provider: string; id: string };
    return !isHidden(rules, provider, id);
  });
}
export function patchRegistry(registry: PatchedRegistry, getRules: () => HideRule[]): void {
  const object = target(registry);
  const existing = patches.get(object);
  if (existing) { existing.getRules = getRules; return; }
  const runtime = registry.runtime;
  const state: PatchState = {
    getRules,
    all: runtime ? runtime.getModels.bind(runtime) : registry.getAll.bind(registry),
    restores: [],
  };
  try {
    for (const name of runtime ? ["getModels", "getAvailableSnapshot"] : ["getAll", "getAvailable"]) {
      state.restores.push(installMethodPatch(object, name, function (original, ...args) {
        return filter(original.apply(this, args), state.getRules());
      }));
    }
    if (runtime?.getAvailable) state.restores.push(installMethodPatch(object, "getAvailable", async function (original, ...args) {
      // Forward provider and AuthOperationOptions (including cancellation).
      return filter(await original.apply(this, args), state.getRules());
    }));
    state.restores.push(installMethodPatch(object, runtime ? "getModel" : "find", function (original, provider, id, ...rest) {
      return isHidden(state.getRules(), provider, id) ? undefined : original.call(this, provider, id, ...rest);
    }));
    patches.set(object, state);
  } catch (error) {
    for (const restore of state.restores.reverse()) restore();
    throw error;
  }
}
export function unpatchRegistry(registry: PatchedRegistry): void {
  const object = target(registry);
  const state = patches.get(object);
  if (!state) return;
  for (const restore of state.restores.reverse()) restore();
  patches.delete(object);
}
export function isRegistryPatched(registry: PatchedRegistry): boolean { return patches.has(target(registry)); }
export function getUnfilteredModels(registry: PatchedRegistry): unknown[] {
  return [...(patches.get(target(registry))?.all() ?? registry.getAll())];
}
