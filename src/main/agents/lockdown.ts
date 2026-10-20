// What the panel's agents may and may not use, shared by the providers and
// scripts/agent-bench.mts (which runs agents the way the panel does). No
// imports: the benchmark loads this file with plain Node.

// The panel's agent works on the design the user has open: the tools that
// list, open, create or save designs only cost tokens on every call.
export const PANEL_HIDDEN_TOOLS = ['list_designs', 'create_design', 'open_design', 'save_design']

// Claude: besides the polotno MCP tools, only the tools that read the MCP
// server's resources (the design guide).
export const CLAUDE_RESOURCE_TOOLS = ['ListMcpResourcesTool', 'ReadMcpResourceTool']

// Codex features a design conversation must not have. With these off, the
// polotno MCP tools and image generation are the whole toolbox: no shell or
// file viewer that could read the user's files on behalf of a prompt that
// arrived inside a design, no web, browser, connectors, or plugins. (Codex's
// own `exec` stays: it only chains these tools and has no file access.)
export const CODEX_DISABLED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'view_image',
  'apps',
  'plugins',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'multi_agent'
]
