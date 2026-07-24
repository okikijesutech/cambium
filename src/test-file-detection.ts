const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx)$/;

/**
 * Matches regular behavioral test files (*.test.ts, *.spec.tsx, etc.)
 * — files with real logic and assertions that CAN legitimately drift,
 * unlike *.test-d.ts (pure type-signature tests, already excluded
 * entirely in scan-repo.ts's DEFAULT_IGNORE, since those have zero
 * runtime logic by design).
 *
 * This is a separate, opt-in filter (--exclude-tests) rather than a
 * default exclusion, because a test file accumulating too many
 * responsibilities is real, valid signal some people want to see —
 * unlike .test-d.ts files, which are never meaningful drift candidates.
 */
export function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERN.test(filePath);
}
