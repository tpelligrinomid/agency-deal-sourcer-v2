import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  // Your project ref (from the Trigger.dev dashboard)
  project: "proj_jgqepnaqxmghqjpuzwbr",

  // Directories containing your tasks
  dirs: ["./trigger"],

  // Retry configuration
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },

  // Max duration of a task run in seconds
  maxDuration: 600,
});
