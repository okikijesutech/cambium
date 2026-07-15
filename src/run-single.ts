import { computeMetricsForSingleFile } from "./metrics";

const target = process.argv[2];

if (!target) {
  console.error("Usage: ts-node src/run-single.ts <path-to-file.ts>");
  process.exit(1);
}

const metrics = computeMetricsForSingleFile(target);
console.log(JSON.stringify(metrics, null, 2));
