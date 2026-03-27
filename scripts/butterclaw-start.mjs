#!/usr/bin/env node
/**
 * ButterClaw single-command start.
 *
 * Runs `openclaw gateway` by default — no subcommand needed.
 * If no config file exists, creates a minimal one so the gateway
 * can start and serve the setup page. No terminal wizard required.
 *
 * Usage:
 *   npm run bc          → starts gateway (auto-opens setup if needed)
 *   npm run bc gateway  → same as above (explicit)
 *   npm run bc <cmd>    → passes through to openclaw CLI
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runNodeMain } from "./run-node.mjs";

const userArgs = process.argv.slice(2);

// Default to "gateway" when no command is given
const args = userArgs.length === 0 ? ["gateway"] : userArgs;

// Ensure a minimal config exists so the gateway can start.
// Without this, the gateway exits with "Missing config."
const stateDir = path.join(os.homedir(), ".openclaw");
const configPath = path.join(stateDir, "openclaw.json");

if (!fs.existsSync(configPath)) {
  console.log("🧈 No config found — creating minimal config for first-run setup...");
  fs.mkdirSync(stateDir, { recursive: true });

  const token = crypto.randomBytes(24).toString("base64url");
  const minimalConfig = {
    gateway: {
      port: 18789,
      bind: "loopback",
      mode: "local",
      auth: {
        mode: "token",
        token,
      },
    },
    agents: {
      defaults: {
        workspace: path.join(stateDir, "workspace"),
      },
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(minimalConfig, null, 2) + "\n");
  console.log(`   Config written to ${configPath}`);
  console.log(`   Gateway token: ${token}`);
  console.log("");
}

void runNodeMain({ args })
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
