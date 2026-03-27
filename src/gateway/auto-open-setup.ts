/**
 * ButterClaw Auto-Open Setup Page
 *
 * After the gateway starts, checks if first-run setup is needed.
 * If so, opens the browser to the Control UI (which will show the
 * setup page). If setup is already complete, does nothing.
 *
 * Called from the gateway run flow after the server binds successfully.
 * Non-blocking — failure to open the browser is not an error.
 */

import { exec } from "node:child_process";
import { loadConfig } from "../config/config.js";
import { resolveGatewayAuth } from "./auth.js";
import { needsFirstRunSetup } from "./setup-detection.js";

/**
 * If first-run setup is needed, attempt to open the browser to the
 * Control UI setup page. Prints the URL to console regardless.
 *
 * Reads the gateway auth token from config so it can include it in
 * the URL for automatic authentication.
 *
 * @param port - Gateway port number
 */
export async function maybeOpenSetupInBrowser(
  port: number,
): Promise<void> {
  try {
    const config = loadConfig();
    const isSetup = needsFirstRunSetup(config);

    // Resolve the gateway token from config for URL auto-auth
    let token: string | undefined;
    try {
      const auth = resolveGatewayAuth(config);
      token = auth.token;
    } catch {
      // Token resolution can fail on unconfigured systems — that's fine
    }

    const baseUrl = `http://127.0.0.1:${port}`;
    const authedUrl = token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;

    if (isSetup) {
      console.log("");
      console.log("🧈 First-run setup required.");
      console.log(`   Open this URL to configure ButterClaw:`);
      console.log(`   ${authedUrl}`);
      console.log("");
    }

    // Cross-platform browser open (fire-and-forget, non-blocking)
    const openCommand =
      process.platform === "darwin"
        ? `open "${authedUrl}"`
        : process.platform === "win32"
          ? `start "" "${authedUrl}"`
          : `xdg-open "${authedUrl}"`;

    exec(openCommand, (err) => {
      if (err) {
        console.log(`   Could not open browser — open manually: ${authedUrl}`);
      }
    });
  } catch {
    // Non-blocking — if anything fails, the user can still open the URL manually
  }
}
