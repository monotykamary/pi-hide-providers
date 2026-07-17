import { isHidden, type HideRule } from "./index.js";

interface ModelLike {
  provider: string;
  id: string;
}

interface ModelRuntimeLike {
  getModels(providerId?: string): readonly unknown[];
  getAvailableSnapshot(): readonly unknown[];
  getAvailable?(providerId?: string): Promise<readonly unknown[]>;
  getModel(provider: string, modelId: string): unknown | undefined;
  __hide_providers_runtime_patched?: boolean;
  __hide_providers_get_rules?: () => HideRule[];
  __hide_providers_orig_getModels?: (providerId?: string) => readonly unknown[];
  __hide_providers_orig_getAvailableSnapshot?: () => readonly unknown[];
  __hide_providers_orig_getAvailable?: (providerId?: string) => Promise<readonly unknown[]>;
  __hide_providers_orig_getModel?: (provider: string, modelId: string) => unknown | undefined;
}

export interface PatchedRegistry {
  __hide_providers_patched?: boolean;
  runtime?: ModelRuntimeLike;
  getAvailable(): unknown[];
  getAll(): unknown[];
  find(provider: string, modelId: string): unknown | undefined;
  __hide_providers_get_rules?: () => HideRule[];
  __hide_providers_orig_getAvailable?: () => unknown[];
  __hide_providers_orig_getAll?: () => unknown[];
  __hide_providers_orig_find?: (provider: string, modelId: string) => unknown | undefined;
}

function filterModels(models: readonly unknown[], rules: ReadonlyArray<HideRule>): unknown[] {
  return models.filter((model) => {
    const candidate = model as ModelLike;
    return !isHidden(rules, candidate.provider, candidate.id);
  });
}

function getRuntime(registry: PatchedRegistry): ModelRuntimeLike | undefined {
  const runtime = registry.runtime;
  return runtime &&
    typeof runtime.getModels === "function" &&
    typeof runtime.getAvailableSnapshot === "function" &&
    typeof runtime.getModel === "function"
    ? runtime
    : undefined;
}

function patchRuntime(runtime: ModelRuntimeLike, getRules: () => HideRule[]): void {
  if (runtime.__hide_providers_runtime_patched) {
    runtime.__hide_providers_get_rules = getRules;
    return;
  }

  runtime.__hide_providers_runtime_patched = true;
  runtime.__hide_providers_get_rules = getRules;
  runtime.__hide_providers_orig_getModels = runtime.getModels.bind(runtime);
  runtime.__hide_providers_orig_getAvailableSnapshot = runtime.getAvailableSnapshot.bind(runtime);
  runtime.__hide_providers_orig_getModel = runtime.getModel.bind(runtime);
  if (runtime.getAvailable) {
    runtime.__hide_providers_orig_getAvailable = runtime.getAvailable.bind(runtime);
  }

  runtime.getModels = function (this: ModelRuntimeLike, providerId?: string) {
    return filterModels(
      this.__hide_providers_orig_getModels!(providerId),
      this.__hide_providers_get_rules!(),
    );
  };
  runtime.getAvailableSnapshot = function (this: ModelRuntimeLike) {
    return filterModels(
      this.__hide_providers_orig_getAvailableSnapshot!(),
      this.__hide_providers_get_rules!(),
    );
  };
  if (runtime.__hide_providers_orig_getAvailable) {
    runtime.getAvailable = async function (this: ModelRuntimeLike, providerId?: string) {
      return filterModels(
        await this.__hide_providers_orig_getAvailable!(providerId),
        this.__hide_providers_get_rules!(),
      );
    };
  }
  runtime.getModel = function (this: ModelRuntimeLike, provider: string, modelId: string) {
    if (isHidden(this.__hide_providers_get_rules!(), provider, modelId)) return undefined;
    return this.__hide_providers_orig_getModel!(provider, modelId);
  };
}

function unpatchRuntime(runtime: ModelRuntimeLike): void {
  if (!runtime.__hide_providers_runtime_patched) return;

  runtime.getModels = runtime.__hide_providers_orig_getModels!;
  runtime.getAvailableSnapshot = runtime.__hide_providers_orig_getAvailableSnapshot!;
  runtime.getModel = runtime.__hide_providers_orig_getModel!;
  if (runtime.__hide_providers_orig_getAvailable) {
    runtime.getAvailable = runtime.__hide_providers_orig_getAvailable;
  }

  delete runtime.__hide_providers_runtime_patched;
  delete runtime.__hide_providers_get_rules;
  delete runtime.__hide_providers_orig_getModels;
  delete runtime.__hide_providers_orig_getAvailableSnapshot;
  delete runtime.__hide_providers_orig_getAvailable;
  delete runtime.__hide_providers_orig_getModel;
}

export function patchRegistry(registry: PatchedRegistry, getRules: () => HideRule[]): void {
  const runtime = getRuntime(registry);
  if (runtime) patchRuntime(runtime, getRules);

  if (registry.__hide_providers_patched) {
    registry.__hide_providers_get_rules = getRules;
    return;
  }

  // Current pi internals read ModelRuntime directly. Patching its compatibility
  // ModelRegistry facade too would only double-filter results. Older pi versions
  // do not expose the runtime, so retain the original registry patch as fallback.
  if (runtime) return;

  registry.__hide_providers_patched = true;
  registry.__hide_providers_get_rules = getRules;
  registry.__hide_providers_orig_getAvailable = registry.getAvailable.bind(registry);
  registry.__hide_providers_orig_getAll = registry.getAll.bind(registry);
  registry.__hide_providers_orig_find = registry.find.bind(registry);

  registry.getAvailable = function (this: PatchedRegistry) {
    return filterModels(
      this.__hide_providers_orig_getAvailable!(),
      this.__hide_providers_get_rules!(),
    );
  };
  registry.getAll = function (this: PatchedRegistry) {
    return filterModels(
      this.__hide_providers_orig_getAll!(),
      this.__hide_providers_get_rules!(),
    );
  };
  registry.find = function (this: PatchedRegistry, provider: string, modelId: string) {
    if (isHidden(this.__hide_providers_get_rules!(), provider, modelId)) return undefined;
    return this.__hide_providers_orig_find!(provider, modelId);
  };
}

export function unpatchRegistry(registry: PatchedRegistry): void {
  const runtime = getRuntime(registry);
  if (runtime) unpatchRuntime(runtime);

  if (!registry.__hide_providers_patched) return;
  registry.getAvailable = registry.__hide_providers_orig_getAvailable!;
  registry.getAll = registry.__hide_providers_orig_getAll!;
  registry.find = registry.__hide_providers_orig_find!;

  delete registry.__hide_providers_patched;
  delete registry.__hide_providers_get_rules;
  delete registry.__hide_providers_orig_getAvailable;
  delete registry.__hide_providers_orig_getAll;
  delete registry.__hide_providers_orig_find;
}

export function isRegistryPatched(registry: PatchedRegistry): boolean {
  return Boolean(
    registry.__hide_providers_patched || getRuntime(registry)?.__hide_providers_runtime_patched,
  );
}

export function getUnfilteredModels(registry: PatchedRegistry): unknown[] {
  const runtime = getRuntime(registry);
  if (runtime?.__hide_providers_orig_getModels) {
    return [...runtime.__hide_providers_orig_getModels()];
  }
  if (registry.__hide_providers_orig_getAll) {
    return registry.__hide_providers_orig_getAll();
  }
  return registry.getAll();
}
