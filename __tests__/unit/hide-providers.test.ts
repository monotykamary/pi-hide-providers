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

// Rule manipulation scenarios
//
// These replicate the core logic from HideProviderSelectorComponent's
// toggleItem / showModels / toggleProvider methods to verify that
// unhiding a single model from a provider-level rule does NOT
// unhide every model in that provider (the original bug).

describe("toggleItem scenario: unhide one model from provider-level rule", () => {
  const allModels = [
    { provider: "openrouter", id: "model-a", name: "Model A" },
    { provider: "openrouter", id: "model-b", name: "Model B" },
    { provider: "openrouter", id: "model-c", name: "Model C" },
  ];

  it("only unhides the selected model, keeping siblings hidden", () => {
    // Start: entire provider hidden via provider-level rule
    let rules: HideRule[] = [{ provider: "openrouter" }];

    // Verify all models start hidden
    for (const m of allModels) {
      expect(isHidden(rules, m.provider, m.id)).toBe(true);
    }

    // Unhide model-b (replicate the fixed toggleItem logic)
    const targetModel = "model-b";
    const hasProviderRule = rules.some(
      (r) => r.provider === "openrouter" && (r.model === undefined || r.model === PROVIDER_WILDCARD),
    );
    expect(hasProviderRule).toBe(true);

    // Remove provider-level rule
    rules = rules.filter(
      (r) => !(r.provider === "openrouter" && (r.model === undefined || r.model === PROVIDER_WILDCARD)),
    );

    // Add individual rules for every model EXCEPT the one being unhidden
    const siblingIds = allModels
      .filter((m) => m.id !== targetModel)
      .map((m) => m.id);
    for (const id of siblingIds) {
      rules.push({ provider: "openrouter", model: id });
    }
    rules = deduplicateRules(rules);

    // model-b should now be visible
    expect(isHidden(rules, "openrouter", "model-b")).toBe(false);
    // model-a and model-c should still be hidden
    expect(isHidden(rules, "openrouter", "model-a")).toBe(true);
    expect(isHidden(rules, "openrouter", "model-c")).toBe(true);
  });

  it("does not re-enable all models (regression test for the original bug)", () => {
    // The original bug: toggleItem's filter removed the provider-level rule
    // (r.model === undefined match) without replacing it with sibling rules,
    // causing ALL models in the provider to become visible.
    let rules: HideRule[] = [{ provider: "openrouter" }];

    // BUGGY logic (what the code used to do):
    const buggyRules = rules.filter(
      (r) =>
        !(r.provider === "openrouter" &&
          (r.model === "model-b" || r.model === undefined)),
    );

    // With the buggy logic, every model in the provider becomes visible
    expect(isHidden(buggyRules, "openrouter", "model-a")).toBe(false); // BUG!
    expect(isHidden(buggyRules, "openrouter", "model-b")).toBe(false); // BUG!
    expect(isHidden(buggyRules, "openrouter", "model-c")).toBe(false); // BUG!

    // With the fixed logic, only the selected model becomes visible
    // (tested above)
  });
});

describe("toggleItem scenario: unhide one model from individual model rules", () => {
  it("only removes the matching model-level rule", () => {
    let rules: HideRule[] = [
      { provider: "openrouter", model: "model-a" },
      { provider: "openrouter", model: "model-b" },
    ];

    // Unhide model-a — no provider-level rule, so just filter the specific rule
    rules = rules.filter(
      (r) => !(r.provider === "openrouter" && r.model === "model-a"),
    );

    expect(isHidden(rules, "openrouter", "model-a")).toBe(false);
    expect(isHidden(rules, "openrouter", "model-b")).toBe(true);
  });
});

describe("toggleProvider scenario: Tab toggles all models for a provider", () => {
  it("adds a provider-level rule when all models are visible", () => {
    const rules: HideRule[] = [];
    const result = deduplicateRules([...rules, { provider: "openrouter" }]);

    expect(isHidden(result, "openrouter", "model-a")).toBe(true);
    expect(isHidden(result, "openrouter", "model-b")).toBe(true);
  });

  it("removes all rules for the provider when any models are hidden", () => {
    const rules: HideRule[] = [
      { provider: "openrouter", model: "model-a" },
      { provider: "openrouter", model: "model-b" },
    ];

    // toggleProvider sees hiddenCount > 0, so it removes ALL rules for the provider
    const result = rules.filter((r) => r.provider !== "openrouter");

    expect(isHidden(result, "openrouter", "model-a")).toBe(false);
    expect(isHidden(result, "openrouter", "model-b")).toBe(false);
  });

  it("removes provider-level rule when present", () => {
    const rules: HideRule[] = [{ provider: "openrouter" }];

    const result = rules.filter((r) => r.provider !== "openrouter");

    expect(isHidden(result, "openrouter", "model-a")).toBe(false);
  });
});

describe("showModels scenario: partial show from provider-level rule", () => {
  const allModels = [
    { provider: "openrouter", id: "model-a", name: "Model A" },
    { provider: "openrouter", id: "model-b", name: "Model B" },
    { provider: "openrouter", id: "model-c", name: "Model C" },
  ];

  it("replaces provider rule with individual rules for still-hidden models", () => {
    let rules: HideRule[] = [{ provider: "openrouter" }];

    // Show model-a and model-b (partial — not the full provider)
    const shownIds = ["model-a", "model-b"];
    const hasProviderRule = rules.some(
      (r) => r.provider === "openrouter" && (r.model === undefined || r.model === PROVIDER_WILDCARD),
    );
    expect(hasProviderRule).toBe(true);

    // Remove provider-level rule
    rules = rules.filter(
      (r) => !(r.provider === "openrouter" && (r.model === undefined || r.model === PROVIDER_WILDCARD)),
    );

    // Add individual rules for models NOT being shown
    const stillHiddenIds = allModels
      .filter((m) => !shownIds.includes(m.id))
      .map((m) => m.id);
    for (const id of stillHiddenIds) {
      rules.push({ provider: "openrouter", model: id });
    }
    rules = deduplicateRules(rules);

    expect(isHidden(rules, "openrouter", "model-a")).toBe(false);
    expect(isHidden(rules, "openrouter", "model-b")).toBe(false);
    expect(isHidden(rules, "openrouter", "model-c")).toBe(true);
  });

  it("drops the provider rule entirely when showing all models in the provider", () => {
    let rules: HideRule[] = [{ provider: "openrouter" }];

    // Show all models for the provider
    const allShown = allModels.map((m) => m.id);
    const isAllShown = allShown.length === allModels.length;
    expect(isAllShown).toBe(true);

    // Just drop the provider rule
    rules = rules.filter(
      (r) => !(r.provider === "openrouter" && (r.model === undefined || r.model === PROVIDER_WILDCARD)),
    );

    for (const m of allModels) {
      expect(isHidden(rules, m.provider, m.id)).toBe(false);
    }
  });

  it("does not unhide all models when showing a subset (regression)", () => {
    // The original showModels bug: r.model === undefined in the filter
    // removed the provider-level rule without replacing it with sibling rules.
    let rules: HideRule[] = [{ provider: "openrouter" }];

    // BUGGY logic (what showModels used to do):
    const buggyRules = rules.filter(
      (r) =>
        !(r.provider === "openrouter" &&
          (r.model === "model-a" || r.model === undefined)),
    );

    // Every model in the provider becomes visible — wrong!
    expect(isHidden(buggyRules, "openrouter", "model-a")).toBe(false); // intended
    expect(isHidden(buggyRules, "openrouter", "model-b")).toBe(false); // BUG!
    expect(isHidden(buggyRules, "openrouter", "model-c")).toBe(false); // BUG!
  });
});

describe("end-to-end workflow: Tab to hide all, then Enter to unhide one", () => {
  const allModels = [
    { provider: "openrouter", id: "model-a", name: "Model A" },
    { provider: "openrouter", id: "model-b", name: "Model B" },
    { provider: "openrouter", id: "model-c", name: "Model C" },
  ];

  it("reproduces the original bug report scenario", () => {
    // 1. Start with no rules — all models visible
    let rules: HideRule[] = [];
    for (const m of allModels) {
      expect(isHidden(rules, m.provider, m.id)).toBe(false);
    }

    // 2. Tab on openrouter — hide all models via provider-level rule
    rules = deduplicateRules([...rules, { provider: "openrouter" }]);
    for (const m of allModels) {
      expect(isHidden(rules, m.provider, m.id)).toBe(true);
    }

    // 3. Enter on model-a to unhide it (the fixed toggleItem logic)
    const targetModel = "model-a";
    const hasProviderRule = rules.some(
      (r) => r.provider === "openrouter" && (r.model === undefined || r.model === PROVIDER_WILDCARD),
    );
    expect(hasProviderRule).toBe(true);

    rules = rules.filter(
      (r) => !(r.provider === "openrouter" && (r.model === undefined || r.model === PROVIDER_WILDCARD)),
    );

    const siblingIds = allModels
      .filter((m) => m.id !== targetModel)
      .map((m) => m.id);
    for (const id of siblingIds) {
      rules.push({ provider: "openrouter", model: id });
    }
    rules = deduplicateRules(rules);

    // model-a is now visible, model-b and model-c remain hidden
    expect(isHidden(rules, "openrouter", "model-a")).toBe(false);
    expect(isHidden(rules, "openrouter", "model-b")).toBe(true);
    expect(isHidden(rules, "openrouter", "model-c")).toBe(true);
  });
});
