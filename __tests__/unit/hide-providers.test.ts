import {
  isHidden,
  parseRule,
  formatRule,
  deduplicateRules,
  PROVIDER_WILDCARD,
  type HideRule,
} from "../../src/index.js";

// isHidden

describe("isHidden", () => {
  const rules: HideRule[] = [
    { provider: "ollama" },
    { provider: "openrouter", model: "cheap-model" },
  ];

  it("hides entire provider when rule has no model field", () => {
    expect(isHidden(rules, "ollama", "llama3")).toBe(true);
    expect(isHidden(rules, "ollama", "qwen2")).toBe(true);
  });

  it("hides specific model when rule has a model field", () => {
    expect(isHidden(rules, "openrouter", "cheap-model")).toBe(true);
    expect(isHidden(rules, "openrouter", "good-model")).toBe(false);
  });

  it("does not hide unmatched providers", () => {
    expect(isHidden(rules, "anthropic", "claude-sonnet-4")).toBe(false);
  });

  it("treats wildcard model as hide-entire-provider", () => {
    const wildcardRules: HideRule[] = [{ provider: "ollama", model: PROVIDER_WILDCARD }];
    expect(isHidden(wildcardRules, "ollama", "anything")).toBe(true);
  });

  it("matches exact model id only", () => {
    const exactRules: HideRule[] = [{ provider: "google", model: "gemini-2.5-flash" }];
    expect(isHidden(exactRules, "google", "gemini-2.5-flash")).toBe(true);
    expect(isHidden(exactRules, "google", "gemini-2.5-pro")).toBe(false);
  });

  it("returns false for empty rules list", () => {
    expect(isHidden([], "ollama", "llama3")).toBe(false);
  });

  it("matches any rule in the list (OR semantics)", () => {
    const multiRules: HideRule[] = [
      { provider: "a" },
      { provider: "b", model: "specific" },
    ];
    expect(isHidden(multiRules, "a", "anything")).toBe(true);
    expect(isHidden(multiRules, "b", "specific")).toBe(true);
    expect(isHidden(multiRules, "b", "other")).toBe(false);
    expect(isHidden(multiRules, "c", "anything")).toBe(false);
  });
});

// parseRule

describe("parseRule", () => {
  it("parses a bare provider name", () => {
    expect(parseRule("ollama")).toEqual({ provider: "ollama" });
  });

  it("parses provider/* as provider-only rule", () => {
    expect(parseRule("ollama/*")).toEqual({ provider: "ollama" });
  });

  it("parses provider/model-id", () => {
    expect(parseRule("openrouter/cheap-model")).toEqual({
      provider: "openrouter",
      model: "cheap-model",
    });
  });

  it("returns null for empty string", () => {
    expect(parseRule("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseRule("   ")).toBeNull();
  });

  it("returns null for /model without provider", () => {
    expect(parseRule("/model-id")).toBeNull();
  });

  it("handles model ids with colons", () => {
    expect(parseRule("openrouter/anthropic:claude-3")).toEqual({
      provider: "openrouter",
      model: "anthropic:claude-3",
    });
  });

  it("trims whitespace", () => {
    expect(parseRule("  ollama  ")).toEqual({ provider: "ollama" });
  });
});

// formatRule

describe("formatRule", () => {
  it("formats provider-only rule with wildcard", () => {
    expect(formatRule({ provider: "ollama" })).toBe("ollama/*");
  });

  it("formats explicit wildcard model rule", () => {
    expect(formatRule({ provider: "ollama", model: "*" })).toBe("ollama/*");
  });

  it("formats specific model rule", () => {
    expect(formatRule({ provider: "openrouter", model: "cheap-model" })).toBe(
      "openrouter/cheap-model",
    );
  });
});

// deduplicateRules

describe("deduplicateRules", () => {
  it("removes duplicate provider rules", () => {
    const rules: HideRule[] = [
      { provider: "ollama" },
      { provider: "ollama" },
    ];
    expect(deduplicateRules(rules)).toEqual([{ provider: "ollama" }]);
  });

  it("removes duplicate specific model rules", () => {
    const rules: HideRule[] = [
      { provider: "openrouter", model: "cheap" },
      { provider: "openrouter", model: "cheap" },
    ];
    expect(deduplicateRules(rules)).toEqual([{ provider: "openrouter", model: "cheap" }]);
  });

  it("keeps different rules for same provider", () => {
    const rules: HideRule[] = [
      { provider: "openrouter", model: "cheap" },
      { provider: "openrouter", model: "expensive" },
    ];
    expect(deduplicateRules(rules)).toHaveLength(2);
  });

  it("treats provider-only and provider/* as same rule", () => {
    const rules: HideRule[] = [
      { provider: "ollama" },
      { provider: "ollama", model: "*" },
    ];
    expect(deduplicateRules(rules)).toHaveLength(1);
  });

  it("returns empty array for empty input", () => {
    expect(deduplicateRules([])).toEqual([]);
  });
});
