import { describe, it, expect } from "vitest";
import {
  isIgnoredByPragma,
  parseIgnoreContent,
  globPatternToRegex,
  createIgnoreMatcher,
} from "../src/ignore";

describe("ignore — inline @cambium-ignore pragma", () => {
  it("detects single-line and multiline comments containing @cambium-ignore", () => {
    expect(isIgnoredByPragma("// @cambium-ignore\nexport const a = 1;")).toBe(true);
    expect(isIgnoredByPragma("//   @cambium-ignore\nexport const a = 1;")).toBe(true);
    expect(isIgnoredByPragma("/* @cambium-ignore */\nexport const a = 1;")).toBe(true);
    expect(isIgnoredByPragma("/*\n * @cambium-ignore\n */\nexport const a = 1;")).toBe(true);
  });

  it("does not match regular code or different comments", () => {
    expect(isIgnoredByPragma("export const a = 1;")).toBe(false);
    expect(isIgnoredByPragma("// @ts-ignore\nexport const a = 1;")).toBe(false);
    expect(isIgnoredByPragma("// cambium is awesome\nexport const a = 1;")).toBe(false);
    expect(isIgnoredByPragma("const x = '@cambium-ignore';")).toBe(false);
  });
});

describe("ignore — parseIgnoreContent", () => {
  it("parses lines, ignores empty lines, and strips comments", () => {
    const raw = `
      # Comment line
      src/generated/**

      # Another comment
      fixtures/
      *.stories.tsx
    `;

    const parsed = parseIgnoreContent(raw);
    expect(parsed).toEqual(["src/generated/**", "fixtures/", "*.stories.tsx"]);
  });
});

describe("ignore — glob pattern matching", () => {
  it("matches recursive wildcards (**)", () => {
    const regex = globPatternToRegex("src/data/**");
    expect(regex.test("src/data/curriculum.ts")).toBe(true);
    expect(regex.test("src/data/nested/sub/file.ts")).toBe(true);
    expect(regex.test("src/services/ai.ts")).toBe(false);
  });

  it("matches trailing directory slashes", () => {
    const regex = globPatternToRegex("fixtures/");
    expect(regex.test("fixtures/sample.ts")).toBe(true);
    expect(regex.test("fixtures/sub/nested.ts")).toBe(true);
    expect(regex.test("src/fixtures.ts")).toBe(false);
  });

  it("matches bare filenames anywhere in repository", () => {
    const regex = globPatternToRegex("*.stories.tsx");
    expect(regex.test("src/components/Button.stories.tsx")).toBe(true);
    expect(regex.test("Button.stories.tsx")).toBe(true);
    expect(regex.test("src/components/Button.tsx")).toBe(false);
  });

  it("matches specific single file name anywhere", () => {
    const regex = globPatternToRegex("schema.ts");
    expect(regex.test("src/db/schema.ts")).toBe(true);
    expect(regex.test("schema.ts")).toBe(true);
    expect(regex.test("src/db/schema.test.ts")).toBe(false);
  });

  it("createIgnoreMatcher matches relative to repoRoot", () => {
    const matcher = createIgnoreMatcher(
      ["src/generated/**", "fixtures/"],
      "/project/root"
    );

    expect(matcher("/project/root/src/generated/types.ts")).toBe(true);
    expect(matcher("/project/root/fixtures/mock.ts")).toBe(true);
    expect(matcher("/project/root/src/index.ts")).toBe(false);
  });
});
