import { describe, it, expect, vi, afterEach } from "vitest";
import { normalizeGitBashPath, normalizePathKey } from "../src/git-paths";

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
