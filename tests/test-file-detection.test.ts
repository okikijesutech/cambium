import { describe, it, expect } from "vitest";
import { isTestFile } from "../src/test-file-detection";

describe("isTestFile", () => {
  it("matches .test.ts and .test.tsx", () => {
    expect(isTestFile("src/foo.test.ts")).toBe(true);
    expect(isTestFile("src/Foo.test.tsx")).toBe(true);
  });

  it("matches .spec.ts and .spec.tsx", () => {
    expect(isTestFile("src/foo.spec.ts")).toBe(true);
    expect(isTestFile("src/Foo.spec.tsx")).toBe(true);
  });

  it("does NOT match .test-d.ts (a different, already-excluded-elsewhere pattern)", () => {
    expect(isTestFile("test-d/pipe.test-d.ts")).toBe(false);
  });

  it("does not match regular source files", () => {
    expect(isTestFile("src/context.ts")).toBe(false);
    expect(isTestFile("src/testUtils.ts")).toBe(false); // "test" in the name, not the suffix
  });
});
