import { describe, it, expect } from "vitest";
import { validateDriftAnalysis } from "../src/drift-validation";

function makeResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    inferredOriginalPurpose: "test purpose",
    currentResponsibilities: ["a", "b"],
    hasDrifted: true,
    driftSummary: "test summary",
    suggestedSplit: null,
    ...overrides,
  };
}

describe("validateDriftAnalysis — duplicate symbol detection", () => {
  it("flags the same symbol appearing in two suggested files (real popup.ts case)", () => {
    const parsed = makeResponse({
      suggestedSplit: [
        { newFileName: "popup-ui.ts", responsibility: "UI", movedExports: ["loginBtn", "syncBtn"] },
        { newFileName: "popup-logic.ts", responsibility: "Logic", movedExports: ["loginBtn", "syncBtn"] },
      ],
    });
    const result = validateDriftAnalysis(parsed, JSON.stringify(parsed), [], []);
    expect(result.warnings.some((w) => w.includes("loginBtn"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("syncBtn"))).toBe(true);
  });

  it("does not warn when every symbol appears in exactly one file", () => {
    const parsed = makeResponse({
      suggestedSplit: [
        { newFileName: "a.ts", responsibility: "A", movedExports: ["x"] },
        { newFileName: "b.ts", responsibility: "B", movedExports: ["y"] },
      ],
    });
    const result = validateDriftAnalysis(parsed, JSON.stringify(parsed), ["x", "y"], []);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("validateDriftAnalysis — imported vs unexported symbols (real drift.ts case)", () => {
  it("distinguishes imported symbols from unexported local ones", () => {
    const parsed = makeResponse({
      suggestedSplit: [
        { newFileName: "drift-analysis.ts", responsibility: "x", movedExports: ["resolveProvider", "analyzeDrift"] },
        { newFileName: "result-formatting.ts", responsibility: "y", movedExports: ["formatDriftReportMarkdown"] },
      ],
    });
    const importedSymbolNames = ["analyzeDrift", "formatDriftReportMarkdown", "scanRepo"];
    const result = validateDriftAnalysis(
      parsed,
      JSON.stringify(parsed),
      ["registerDriftCommand"],
      importedSymbolNames
    );

    const importedWarning = result.warnings.find((w) => w.includes("IMPORTED"));
    expect(importedWarning).toBeDefined();
    expect(importedWarning).toContain("analyzeDrift");
    expect(importedWarning).toContain("formatDriftReportMarkdown");
    expect(importedWarning).not.toContain("resolveProvider");

    const localWarning = result.warnings.find((w) => w.includes("unexported internal"));
    expect(localWarning).toBeDefined();
    expect(localWarning).toContain("resolveProvider");
  });

  it("gives one summary warning, not one per symbol, when a file has zero real exports", () => {
    const parsed = makeResponse({
      suggestedSplit: [{ newFileName: "a.ts", responsibility: "x", movedExports: ["foo", "bar"] }],
    });
    const result = validateDriftAnalysis(parsed, JSON.stringify(parsed), [], []);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("no real exported symbols");
  });
});

describe("validateDriftAnalysis — internal consistency (hasDrifted vs suggestedSplit)", () => {
  it("suppresses a suggestedSplit when hasDrifted is false (contradictory)", () => {
    const parsed = makeResponse({
      hasDrifted: false,
      suggestedSplit: [{ newFileName: "a.ts", responsibility: "a", movedExports: ["a"] }],
    });
    const result = validateDriftAnalysis(parsed, JSON.stringify(parsed), ["a"], []);
    expect(result.suggestedSplit).toBeNull();
    expect(result.warnings.some((w) => w.includes("contradictory"))).toBe(true);
  });

  it("warns without fabricating a split when hasDrifted is true but no split given", () => {
    const parsed = makeResponse({ hasDrifted: true, suggestedSplit: null });
    const result = validateDriftAnalysis(parsed, JSON.stringify(parsed), ["a"], []);
    expect(result.suggestedSplit).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("produces zero warnings for a normal, consistent response", () => {
    const parsed = makeResponse({
      hasDrifted: true,
      suggestedSplit: [{ newFileName: "a.ts", responsibility: "a", movedExports: ["a"] }],
    });
    const result = validateDriftAnalysis(parsed, JSON.stringify(parsed), ["a"], []);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("validateDriftAnalysis — description-to-split mismatch (heuristic)", () => {
  it("flags a real bug: a currentResponsibilities item with no representation anywhere in the suggested split (real school_web_project bulk-upload route.ts case)", () => {
    const parsed = {
      inferredOriginalPurpose: "Handling bulk student uploads for a school management system.",
      currentResponsibilities: [
        "Validating and processing student data from a bulk upload request.",
        "Creating user accounts and profiles for students and their guardians.",
        "Generating temporary passwords and sending setup notifications to users.",
        "Managing database transactions to ensure atomicity of operations.",
      ],
      hasDrifted: true,
      driftSummary: "test",
      suggestedSplit: [
        {
          newFileName: "student-validation.ts",
          responsibility: "Validating and processing student data from a bulk upload request.",
          movedExports: ["normalizeOptionalString"],
        },
        {
          newFileName: "user-account-creation.ts",
          responsibility: "Creating user accounts and profiles for students and their guardians.",
          movedExports: ["generateTemporaryPassword"],
        },
        {
          // Real bug: this file's NAME suggests notifications, but its stated
          // responsibility text is about database transactions instead —
          // "temporary passwords / setup notifications" is addressed nowhere.
          newFileName: "notification-service.ts",
          responsibility: "Managing database transactions to ensure atomicity of operations.",
          movedExports: ["NotificationService", "sendWelcomeCredentials"],
        },
      ],
    };

    const result = validateDriftAnalysis(parsed, JSON.stringify(parsed), [], []);
    const warning = result.warnings.find((w) => w.includes("description mismatch"));
    expect(warning).toBeDefined();
    expect(warning).toContain("temporary passwords");
  });

  it("does not false-positive on a real, complete split (real proxy.ts case)", () => {
    const parsed = {
      inferredOriginalPurpose: "Authentication and authorization middleware for a Next.js application.",
      currentResponsibilities: [
        "Authentication handling using NextAuth.js.",
        "Authorization checks based on user roles and routes.",
        "Rate limiting for API requests.",
        "Handling public assets and APIs.",
        "Redirecting users based on their role and route access.",
      ],
      hasDrifted: true,
      driftSummary: "test",
      suggestedSplit: [
        { newFileName: "auth.ts", responsibility: "Authentication handling using NextAuth.js.", movedExports: ["default"] },
        { newFileName: "authorization.ts", responsibility: "Authorization checks based on user roles and routes.", movedExports: [] },
        { newFileName: "rate-limiting.ts", responsibility: "Rate limiting for API requests.", movedExports: [] },
        { newFileName: "public-assets.ts", responsibility: "Handling public assets and APIs.", movedExports: [] },
        { newFileName: "redirects.ts", responsibility: "Redirecting users based on their role and route access.", movedExports: [] },
      ],
    };

    const result = validateDriftAnalysis(parsed, JSON.stringify(parsed), [], []);
    expect(result.warnings.some((w) => w.includes("description mismatch"))).toBe(false);
  });

  it("does not run at all when hasDrifted is false (no split to check against)", () => {
    const parsed = {
      inferredOriginalPurpose: "x",
      currentResponsibilities: ["Something totally unrelated to anything."],
      hasDrifted: false,
      driftSummary: "test",
      suggestedSplit: null,
    };
    const result = validateDriftAnalysis(parsed, JSON.stringify(parsed), [], []);
    expect(result.warnings.some((w) => w.includes("description mismatch"))).toBe(false);
  });
});

describe("validateDriftAnalysis — malformed responses fail loudly", () => {
  it("throws when required fields are missing, rather than silently returning partial data", () => {
    const broken = { inferredOriginalPurpose: "x" };
    expect(() => validateDriftAnalysis(broken, JSON.stringify(broken), [], [])).toThrow();
  });
});
