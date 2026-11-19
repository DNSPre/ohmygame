import { build } from "esbuild";
await build({ entryPoints: ["src/daemon/guest-agent-bridge.ts"], bundle: true, platform: "node", target: "node22", format: "esm", outfile: "public/must-agent-bridge.mjs", banner: { js: 'import { createRequire as __createGuestRequire } from "node:module"; const require = __createGuestRequire(import.meta.url);' } });
