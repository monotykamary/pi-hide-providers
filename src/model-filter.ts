import { isHidden, type HideRule } from "./index.js";
import { installMethodPatch, fullyUnwrap } from "./method-patch.js";

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

// Prototype-level patch state. Shared across module reloads via Symbol.for so
// a reloaded extension updates the existing patch instead of stacking a new one.
const RUNTIME_PROTO_STATE = Symbol.for("pi-hide-providers.runtime-prototype.v1");

interface PrototypePatchState {
  suspended: boolean;
  getRules: () => HideRule[];
}

const prototypeStates = new Set<PrototypePatchState>();
function target(registry: PatchedRegistry) { return registry.runtime ?? registry; }
function filter(models: readonly unknown[], rules: HideRule[]): unknown[] {
  return models.filter((model) => {
    const { provider, id } = model as { provider: string; id: string };
    return !isHidden(rules, provider, id);
  });
}
export function patchRegistry(registry: PatchedRegistry, getRules: () => HideRule[]): void {
  resumePrototypeFilters();
  const object = target(registry);
  const existing = patches.get(object);
  if (existing) { existing.getRules = getRules; return; }
  const runtime = registry.runtime;
  const state: PatchState = {
    getRules,
    // Fully unwrap so prototype-level patches do not filter the "unfiltered" view.
    all: runtime ? fullyUnwrap(runtime.getModels).bind(runtime) : registry.getAll.bind(registry),
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

/**
 * Patch ModelRuntime.prototype so hide rules apply to model access that happens
 * before session_start fires — e.g. `pi --list-models`, CLI --model resolution,
 * and default-model resolution. Instance patches installed later on top of this
 * compose via the shared patch protocol; double filtering is idempotent.
 *
 * Best-effort: methods missing on older runtimes are skipped, and callers may
 * wrap this in try/catch to fall back to instance-only patching. Returns a
 * disposer, or undefined when the class has no usable prototype. Installing
 * twice updates the existing patch's rules instead of stacking another one;
 * the disposer then belongs to the original installation.
 */
export function installRuntimePrototypePatch(runtimeClass: unknown, getRules: () => HideRule[]): (() => void) | undefined {
  const proto = (runtimeClass as { prototype?: object } | undefined)?.prototype as
    | (Record<string | symbol, unknown> & { [RUNTIME_PROTO_STATE]?: PrototypePatchState })
    | undefined;
  if (!proto) return undefined;

  const existing = proto[RUNTIME_PROTO_STATE];
  if (existing) {
    existing.getRules = getRules;
    existing.suspended = false;
    prototypeStates.add(existing);
    return () => {};
  }

  const state: PrototypePatchState = { suspended: false, getRules };
  const restores: Array<() => void> = [];
  const guarded = (name: string, handler: (this: any, original: (...args: any[]) => any, ...args: any[]) => any): void => {
    if (typeof proto[name] !== "function") return; // tolerate older runtimes
    restores.push(installMethodPatch(proto, name, handler));
  };

  try {
    for (const name of ["getModels", "getAvailableSnapshot"]) {
      guarded(name, function (original, ...args) {
        return state.suspended ? original.apply(this, args) : filter(original.apply(this, args), state.getRules());
      });
    }
    guarded("getAvailable", async function (original, ...args) {
      // Forward provider and options (including cancellation) untouched.
      return state.suspended ? await original.apply(this, args) : filter(await original.apply(this, args), state.getRules());
    });
    guarded("getModel", function (original, provider: string, id: string, ...rest) {
      return !state.suspended && isHidden(state.getRules(), provider, id)
        ? undefined
        : original.call(this, provider, id, ...rest);
    });
    proto[RUNTIME_PROTO_STATE] = state;
    prototypeStates.add(state);
  } catch (error) {
    for (const restore of restores.reverse()) restore();
    throw error;
  }
  return () => {
    prototypeStates.delete(state);
    delete proto[RUNTIME_PROTO_STATE];
    for (const restore of restores.reverse()) restore();
  };
}

/** Temporarily stop prototype-level filtering (used by /hide-models reset). */
export function suspendPrototypeFilters(): void {
  for (const state of prototypeStates) state.suspended = true;
}

/** Re-enable prototype-level filtering. Any patchRegistry call resumes. */
export function resumePrototypeFilters(): void {
  for (const state of prototypeStates) state.suspended = false;
}
