/**
 * The parts of pi's extension API that this extension uses.
 *
 * pi is the host, not a dependency. The package carries the gateway, not
 * the harness, and the only runtime dependencies it may have are
 * `env-paths` and `proper-lockfile`. So the shapes pi hands the
 * extension are declared here — only the ones the extension touches — and
 * the extension imports nothing from pi at all.
 *
 * That is also what lets pi load the compiled extension as a plain
 * module, with no loader of its own:
 *
 *     pi -e ./dist/integrations/pi/extension.js
 *
 * The declarations follow pi's own `ExtensionAPI`, `ExtensionContext` and
 * `ToolDefinition`. They are checked against the real ones by loading the
 * extension in pi itself (the acceptance criterion of the pi extension),
 * not by a dependency on the harness.
 */

/** How pi tells the user something. */
export type PiNotificationType = 'info' | 'warning' | 'error';

/**
 * A JSON Schema, as a tool declares its arguments.
 *
 * pi accepts a plain JSON Schema: the tool validator falls back to it
 * when the schema is not a TypeBox schema, which is what keeps the
 * extension free of a dependency on the harness' schema library.
 */
export interface PiJsonSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

/** Where a widget is drawn. */
export interface PiWidgetOptions {
  placement?: 'aboveEditor' | 'belowEditor';
}

/**
 * A component pi can draw.
 *
 * The shape is pi-tui's `Component`, declared here so that the extension
 * does not have to import the terminal library to draw a table.
 */
export interface PiComponent {
  /** Draw the component as lines for a viewport of the given width. */
  render(width: number): string[];
  /** Drop what is cached; the next render draws from scratch. */
  invalidate(): void;
  /** Handle a key press, when the component has the focus. */
  handleInput?(data: string): void;
}

/** The factory pi calls for a custom component. */
export type PiComponentFactory<T> = (
  tui: unknown,
  theme: unknown,
  keybindings: unknown,
  done: (result: T) => void,
) => PiComponent;

/** The terminal: what the extension can show and tell. */
export interface PiUiContext {
  /** Show a message to the user. */
  notify(message: string, type?: PiNotificationType): void;
  /** Set the text of a status line in the footer. */
  setStatus(key: string, text: string | undefined): void;
  /** Show a block of lines above or below the editor. */
  setWidget?(key: string, content: string[] | undefined, options?: PiWidgetOptions): void;
  /** Show a component of the extension's own. Interactive mode only. */
  custom?<T>(factory: PiComponentFactory<T>, options?: { overlay?: boolean }): Promise<T>;
}

/** The modes pi runs in. */
export type PiExtensionMode = 'tui' | 'rpc' | 'json' | 'print';

/** What pi tells the extension about the session it runs in. */
export interface PiExtensionContext {
  /** The terminal. */
  ui: PiUiContext;
  /** The mode the session runs in. */
  mode: PiExtensionMode;
  /** Whether a dialog-capable UI is available. */
  hasUI: boolean;
  /** The working directory of the session. */
  cwd: string;
}

/** What a command handler gets. */
export type PiCommandContext = PiExtensionContext;

/** The text part of a tool result. */
export interface PiToolContent {
  type: 'text';
  text: string;
}

/** What a tool answers. */
export interface PiToolResult {
  /** What the model reads. */
  content: PiToolContent[];
  /** What the transcript and the renderer use. */
  details?: unknown;
  /** The result in the shape of `outputSchema`, for programmatic callers. */
  structuredContent?: unknown;
  /** Whether the call failed. */
  isError?: boolean;
}

/** Hints about what a tool does, with the meaning of MCP tool annotations. */
export interface PiToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** A tool the model can call. */
export interface PiToolDefinition {
  /** The name the model calls. */
  name: string;
  /** The name the interface shows. */
  label: string;
  /** What the tool does, in the words the model reads. */
  description: string;
  /** The schema of the arguments. */
  parameters: PiJsonSchema;
  /** The schema of the result. */
  outputSchema?: PiJsonSchema;
  /** One line for the tool list of the system prompt. */
  promptSnippet?: string;
  /** Longer guidance, appended to the guidelines of the system prompt. */
  promptGuidelines?: string[];
  /** Hints about what the tool does. */
  annotations?: PiToolAnnotations;
  /** Do the work. */
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: PiExtensionContext,
  ): Promise<PiToolResult>;
}

/** The event the extension listens to. */
export interface PiSessionStartEvent {
  type: 'session_start';
  /** Why the session started. */
  reason: 'startup' | 'reload' | 'new' | 'resume' | 'fork';
}

/** The event that ends the session. */
export interface PiSessionShutdownEvent {
  type: 'session_shutdown';
}

/** The API pi hands to the extension. */
export interface PiExtensionApi {
  /** Subscribe to an event. */
  on(
    event: 'session_start',
    handler: (event: PiSessionStartEvent, ctx: PiExtensionContext) => Promise<void> | void,
  ): () => void;
  /** Subscribe to the end of the session. */
  on(
    event: 'session_shutdown',
    handler: (event: PiSessionShutdownEvent, ctx: PiExtensionContext) => Promise<void> | void,
  ): () => void;
  /** Register a tool the model can call. */
  registerTool(tool: PiToolDefinition): void;
  /** Register a command. */
  registerCommand(
    name: string,
    options: {
      description?: string;
      handler: (args: string, ctx: PiCommandContext) => Promise<void>;
    },
  ): void;
}
