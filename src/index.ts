/**
 * Shared constants, types, and utilities for pi-hide-providers.
 */

/** Description shown in the / commands list. */
export const HIDE_COMMAND_DESCRIPTION = "Manage which providers/models are hidden from the model selector";

/** Default config file name. */
export const CONFIG_FILENAME = "hide-providers.json";

/** Glob wildcard — matches any model id within a provider. */
export const PROVIDER_WILDCARD = "*";

export interface HideRule {
  /** Provider name to hide (e.g. "ollama", "openrouter"). Required. */
  provider: string;
  /**
   * Model id pattern to hide within the provider.
   * Use "*" to hide all models from the provider.
   * Omit or leave undefined to hide the entire provider.
   */
  model?: string;
}

export interface HideProvidersConfig {
  /** List of hide rules. A model is hidden if it matches ANY rule. */
  hide: HideRule[];
}

/**
 * Check whether a model is matched by any hide rule.
 *
 * A rule matches when:
 * - rule.provider === model.provider (exact, case-sensitive)
 * - AND (rule.model is undefined OR rule.model === "*" OR rule.model === model.id)
 */
export function isHidden(
  rules: ReadonlyArray<HideRule>,
  provider: string,
  modelId: string,
): boolean {
  return rules.some(
    (rule) =>
      rule.provider === provider &&
      (rule.model === undefined || rule.model === PROVIDER_WILDCARD || rule.model === modelId),
  );
}

/**
 * Parse a provider/model reference string into a HideRule.
 *
 * Formats:
 *   "provider"           → { provider }            (hide entire provider)
 *   "provider/*"         → { provider, model: "*" } (hide entire provider, explicit)
 *   "provider/model-id"  → { provider, model: "model-id" } (hide specific model)
 */
export function parseRule(input: string): HideRule | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex === -1) {
    return { provider: trimmed };
  }

  const provider = trimmed.slice(0, slashIndex);
  const model = trimmed.slice(slashIndex + 1);

  if (provider.length === 0) return null;

  return model === PROVIDER_WILDCARD
    ? { provider }
    : { provider, model };
}

/**
 * Format a HideRule as a human-readable string.
 */
export function formatRule(rule: HideRule): string {
  if (rule.model === undefined || rule.model === PROVIDER_WILDCARD) {
    return `${rule.provider}/*`;
  }
  return `${rule.provider}/${rule.model}`;
}

/**
 * Deduplicate hide rules — same provider+model pair only kept once.
 */
export function deduplicateRules(rules: ReadonlyArray<HideRule>): HideRule[] {
  const seen = new Set<string>();
  return rules.filter((rule) => {
    const key = formatRule(rule);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
