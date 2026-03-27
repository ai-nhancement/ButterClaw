export const CONTROL_UI_BOOTSTRAP_CONFIG_PATH = "/__openclaw/control-ui-config.json";

export type ControlUiBootstrapConfig = {
  basePath: string;
  assistantName: string;
  assistantAvatar: string;
  assistantAgentId: string;
  serverVersion?: string;
  /** True when no auth profiles (API keys) are configured — signals the UI to show the setup page. */
  needsSetup?: boolean;
};
