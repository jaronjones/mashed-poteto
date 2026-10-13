// Permission flags for unattended runs (pstack-run, pstack-loop). See ../../references/harness.md → Permissions.
// Full access is opt-in: --permissions full, PSTACK_PERMISSIONS=full, or a
// "bridge permissions: full" line in ~/.config/pstack/models.md.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const MODES = ["default", "full"];

export function resolvePermissions(flag) {
  const value = flag ?? process.env.PSTACK_PERMISSIONS ?? configuredPermissions() ?? "default";
  if (!MODES.includes(value)) throw new Error(`permissions must be one of ${MODES.join(", ")}, got "${value}"`);
  return value;
}

function configuredPermissions() {
  const home = process.env.HOME || homedir();
  const dir = process.env.PSTACK_CONFIG_DIR || join(home, ".config", "pstack");
  try {
    return readFileSync(join(dir, "models.md"), "utf8").match(/^bridge permissions:\s*(\S+)\s*$/m)?.[1];
  } catch {
    return undefined;
  }
}

const CODEX_SANDBOX = { readonly: "read-only", default: "workspace-write", full: "danger-full-access" };
const MODE_FLAG = { readonly: "plan", default: "acceptEdits", full: "bypassPermissions" };

// `resume` matters for codex: `codex exec resume` takes the sandbox as a config override, not -s.
export function permissionArgs(cli, { readonly, permissions, resume = false }) {
  const level = readonly ? "readonly" : permissions;
  switch (cli) {
    case "claude":
    case "grok":
      return ["--permission-mode", MODE_FLAG[level]];
    case "codex":
      return resume ? ["-c", `sandbox_mode="${CODEX_SANDBOX[level]}"`] : ["-s", CODEX_SANDBOX[level]];
    case "opencode":
      // opencode run follows the permissions in opencode.json; it has no per-run escalation flag.
      return readonly ? ["--agent", "plan"] : [];
  }
}
