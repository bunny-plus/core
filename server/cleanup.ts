import { cleanupRecordings } from "./recording-cleanup";

void cleanupRecordings(
  {
    CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID?.trim() ?? "",
    CF_TOKEN: process.env.CF_TOKEN?.trim() ?? "",
    STREAM_URL: process.env.STREAM_URL?.trim() ?? "",
  },
  process.argv.includes("--dry-run"),
).then(
  (result) => console.info("Recording cleanup complete", result),
  (error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  },
);
