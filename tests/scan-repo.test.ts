import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { scanRepo } from "../src/scan-repo";

describe("scanRepo — path validation", () => {
  it("throws a clear error for a path that does not exist (real bug: was silently 'Found 0 files')", () => {
    const fakePath = path.join(os.tmpdir(), "cambium-test-does-not-exist-xyz");
    expect(() => scanRepo(fakePath)).toThrow(/does not exist/);
  });

  it("throws a clear error when the path is a file, not a directory", () => {
    const tmpFile = path.join(os.tmpdir(), `cambium-test-file-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, "not a directory");
    try {
      expect(() => scanRepo(tmpFile)).toThrow(/not a directory/);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it("returns an empty array (not an error) for a real, legitimately empty directory", () => {
    const emptyDir = path.join(os.tmpdir(), `cambium-test-empty-${Date.now()}`);
    fs.mkdirSync(emptyDir, { recursive: true });
    try {
      const results = scanRepo(emptyDir);
      expect(results).toEqual([]);
    } finally {
      fs.rmdirSync(emptyDir);
    }
  });
});
