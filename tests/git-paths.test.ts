import { describe, it, expect, vi, afterEach } from "vitest";
import { normalizeGitBashPath, normalizePathKey, toForwardSlashes } from "../src/git-paths";

describe("toForwardSlashes", () => {
  it("converts Windows backslash paths to forward slashes", () => {
    expect(toForwardSlashes("C:\\Users\\HP\\Desktop\\cambium\\src\\analyze-drift.ts")).toBe(
      "C:/Users/HP/Desktop/cambium/src/analyze-drift.ts"
    );
  });

  it("leaves forward-slash paths unchanged", () => {
    expect(toForwardSlashes("C:/Users/HP/src/file.ts")).toBe("C:/Users/HP/src/file.ts");
  });

  it("makes a path.resolve()-style path match a ts-morph-style path after normalizing (real --file bug)", () => {
    // Real bug: path.resolve() on Windows returns backslashes, but
    // scan-repo.ts (ts-morph) always stores forward slashes — so
    // `cambium drift . --file src/analyze-drift.ts` reported "not
    // found" for a file that genuinely existed in the scan results.
    const fromPathResolve = "C:\\Users\\HP\\Desktop\\cambium\\src\\analyze-drift.ts";
    const fromScanRepo = "C:/Users/HP/Desktop/cambium/src/analyze-drift.ts";
    expect(toForwardSlashes(fromPathResolve)).toBe(fromScanRepo);
  });
});

describe("normalizeGitBashPath", () => {
  it("converts Git Bash POSIX-style paths to Windows drive format", () => {
    expect(normalizeGitBashPath("/c/Users/HP/desktop/pwmngerTS")).toBe(
      "C:/Users/HP/desktop/pwmngerTS"
    );
  });

  it("converts other drive letters correctly", () => {
    expect(normalizeGitBashPath("/d/projects/myrepo")).toBe("D:/projects/myrepo");
  });

  it("leaves an already-normal Windows path unchanged", () => {
    expect(normalizeGitBashPath("C:/Users/HP/desktop/pwmngerTS")).toBe(
      "C:/Users/HP/desktop/pwmngerTS"
    );
  });

  it("leaves a real Linux/Mac absolute path unchanged (must not false-positive)", () => {
    expect(normalizeGitBashPath("/home/user/linux-repo")).toBe("/home/user/linux-repo");
  });
});

describe("normalizePathKey", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lowercases paths on win32 (NTFS is case-insensitive, Map lookups aren't)", () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    const gitStyle = normalizePathKey("C:/Users/HP/Desktop/pwmngerTS/src/popup/popup.ts");
    const tsMorphStyle = normalizePathKey("C:/Users/HP/desktop/pwmngerTS/src/popup/popup.ts");
    expect(gitStyle).toBe(tsMorphStyle);
  });

  it("preserves case on non-Windows platforms", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    expect(normalizePathKey("/Home/User/Repo")).toBe("/Home/User/Repo");
  });
});
