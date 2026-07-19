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

  it("excludes .test-d.ts files (real bug found on execa: pure type-signature test files flooded the outlier ranking, crowding out real production code)", () => {
    const dir = path.join(os.tmpdir(), `cambium-test-typetest-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "types.test-d.ts"),
      `import { expectType } from "tsd";\nexpectType<string>("x" as any);`
    );
    fs.writeFileSync(
      path.join(dir, "real.ts"),
      `export function real(x: number) { if (x > 0) { return x; } return 0; }`
    );
    try {
      const results = scanRepo(dir);
      expect(results).toHaveLength(1);
      expect(results[0].filePath).toContain("real.ts");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does NOT exclude regular .test.ts files (they contain real logic and can legitimately drift)", () => {
    const dir = path.join(os.tmpdir(), `cambium-test-regulartest-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "real.test.ts"),
      `export function helper() { return 1; }`
    );
    try {
      const results = scanRepo(dir);
      expect(results).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
