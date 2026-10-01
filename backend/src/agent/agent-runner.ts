import { Injectable, Logger, Optional } from '@nestjs/common';
import type { AgentLogMeta } from '@agent-board/shared';
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' };
import { AttachmentsService } from '../attachments/attachments.service';
import { extractAttachmentIds } from '../attachments/image-files';
import type { RunHandle } from '../common/run-registry.service';
import { AppConfig } from '../config/app-config';
import { EventsService } from '../events/events.service';
import { BOARD_SERVER_NAME, BOARD_TOOL_NAMES, buildBoardServer } from './board-tools';
import { AgentProcessTracker } from './process-tracker';
import type { RunState } from './run-state';
import { loadSdk } from './sdk-loader';
import { LogThrottler, summarizeToolUse, truncate } from './tool-log';

export const BASE_ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git add:*)',
  'Bash(git commit:*)',
] as const;

export const DISALLOWED_TOOLS = ['WebFetch', 'WebSearch', 'Bash(git push:*)', 'Bash(git checkout:*)'] as const;

/** Assistant prose excerpts: at most one per assistant message, at most this often, this long. */
const TEXT_LOG_MIN_INTERVAL_MS = 15_000;
const TEXT_LOG_MAX_CHARS = 160;
const STDERR_TAIL_LINES = 20;
/** Images referenced from the prompt that are sent to the model, at most this many and this big each. */
export const MAX_PROMPT_IMAGES = 10;
export const MAX_PROMPT_IMAGE_BYTES = 5 * 1024 * 1024;

type UserContent = Exclude<SDKUserMessage['message']['content'], string>;
type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface RunnerTicket {
  id: string;
  number: number;
  worktreePath: string | null;
  sessionId: string | null;
}

export interface RunResultInfo {
  costUsd: number;
  subtype: string;
  isError: boolean;
  numTurns?: number;
  errors?: string[];
}

export interface AgentRunParams {
  ticket: RunnerTicket;
  prompt: string;
  systemAppend: string;
  /** The project's extraAllowedTools. */
  extraAllowedTools?: readonly string[];
  runState: RunState;
  handle: RunHandle;
  onSessionId(sessionId: string): void | Promise<void>;
  onLog(line: string, meta: AgentLogMeta): void | Promise<void>;
  onResult(result: RunResultInfo): void | Promise<void>;
}

export interface AgentRunOutcome {
  sessionId?: string;
  resultSubtype?: string;
  /** Set when the result message reported an error (e.g. max turns reached). */
  resultError?: string;
  aborted: boolean;
}

function isAbortError(err: unknown, sdkAbortError?: new (...args: never[]) => Error): boolean {
  if (sdkAbortError && err instanceof sdkAbortError) return true;
  return err instanceof Error && err.name === 'AbortError';
}

/** Wraps a single `query()` call: builds the options, consumes the stream, reports via callbacks. */
@Injectable()
export class AgentRunner {
  private readonly logger = new Logger(AgentRunner.name);

  constructor(
    private readonly config: AppConfig,
    private readonly events: EventsService,
    @Optional() private readonly processes?: AgentProcessTracker,
    @Optional() private readonly attachments?: AttachmentsService,
  ) {}

  /** base + AGENT_EXTRA_ALLOWED_TOOLS + the project's extra tools + board tools (deduped). */
  allowedTools(projectExtra: readonly string[] = []): string[] {
    return [
      ...new Set([...BASE_ALLOWED_TOOLS, ...this.config.agentExtraAllowedTools, ...projectExtra, ...BOARD_TOOL_NAMES]),
    ];
  }

  buildEnv(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = { ...process.env };
    if (this.config.anthropicApiKey) {
      env.ANTHROPIC_API_KEY = this.config.anthropicApiKey;
    } else {
      // No key configured: let the SDK use the local `claude` CLI login.
      delete env.ANTHROPIC_API_KEY;
    }
    return env;
  }

  async run(params: AgentRunParams): Promise<AgentRunOutcome> {
    const { ticket, handle } = params;
    if (!ticket.worktreePath) throw new Error(`Ticket #${ticket.number} has no worktree`);
    const cwd = ticket.worktreePath;

    const sdk = await loadSdk();
    const stderrTail: string[] = [];

    const onStderr = (data: string) => {
      for (const line of data.split('\n')) {
        if (!line.trim()) continue;
        stderrTail.push(line);
        if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
      }
    };
    const options: Options = {
      cwd,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: params.systemAppend },
      settingSources: ['project'],
      permissionMode: 'acceptEdits',
      allowedTools: this.allowedTools(params.extraAllowedTools),
      disallowedTools: [...DISALLOWED_TOOLS],
      mcpServers: {
        [BOARD_SERVER_NAME]: buildBoardServer(sdk, {
          ticketId: ticket.id,
          runState: params.runState,
          events: this.events,
        }),
      },
      maxTurns: this.config.agentMaxTurns,
      abortController: handle.controller,
      env: this.buildEnv(),
      stderr: onStderr,
    };
    // Track the CLI's PID so a hard API crash can't leave an orphaned agent editing the worktree.
    if (this.processes) options.spawnClaudeCodeProcess = this.processes.spawnFor(ticket.number, onStderr);
    if (ticket.sessionId) options.resume = ticket.sessionId;
    if (this.config.agentModel) options.model = this.config.agentModel;

    const throttler = new LogThrottler((body, meta) => params.onLog(body, meta));
    const outcome: AgentRunOutcome = { aborted: false };
    let lastTextAt = 0;

    try {
      const prompt = await this.buildPrompt(params.prompt, ticket.number);
      const stream = sdk.query({ prompt, options });
      for await (const msg of stream as AsyncIterable<SDKMessage>) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          if (!outcome.sessionId) {
            outcome.sessionId = msg.session_id;
            await params.onSessionId(msg.session_id);
          }
        } else if (msg.type === 'assistant') {
          let textLogged = false;
          for (const block of msg.message.content) {
            if (block.type === 'tool_use') {
              throttler.push(summarizeToolUse(block.name, block.input, cwd), { kind: 'tool', tool: block.name });
            } else if (block.type === 'text' && !textLogged) {
              const text = block.text.trim();
              const now = Date.now();
              if (text && now - lastTextAt >= TEXT_LOG_MIN_INTERVAL_MS) {
                textLogged = true;
                lastTextAt = now;
                throttler.push(truncate(text, TEXT_LOG_MAX_CHARS), { kind: 'text' });
              }
            }
          }
        } else if (msg.type === 'result') {
          outcome.resultSubtype = msg.subtype;
          const errors = msg.subtype === 'success' ? undefined : msg.errors;
          if (msg.subtype !== 'success') {
            outcome.resultError = this.describeResultError(msg.subtype, errors);
          } else if (msg.is_error) {
            outcome.resultError = `The agent run ended with an error: ${truncate(msg.result || 'unknown error', 500)}`;
          }
          await params.onResult({
            costUsd: msg.total_cost_usd ?? 0,
            subtype: msg.subtype,
            isError: msg.is_error,
            numTurns: msg.num_turns,
            ...(errors ? { errors } : {}),
          });
        }
      }
    } catch (err) {
      if (handle.signal.aborted || isAbortError(err, sdk.AbortError)) {
        outcome.aborted = true;
        return outcome;
      }
      if (stderrTail.length > 0 && err instanceof Error) {
        this.logger.warn(`Agent CLI stderr for ticket #${ticket.number}:\n${stderrTail.join('\n')}`);
        err.message = `${err.message}\n${truncate(stderrTail.join(' | '), 500)}`;
      }
      throw err;
    } finally {
      throttler.flush();
    }

    if (handle.signal.aborted) outcome.aborted = true;
    return outcome;
  }

  /**
   * The prompt as given, or, when it references image attachments (`/api/attachments/<id>`), a single
   * streamed user message with the text followed by the images, so the model sees them like a pasted
   * screenshot. Referenced images that are missing or unreadable are skipped (logged by the service).
   */
  async buildPrompt(text: string, ticketNumber: number): Promise<string | AsyncIterable<SDKUserMessage>> {
    const ids = extractAttachmentIds(text);
    if (!this.attachments || ids.length === 0) return text;
    if (ids.length > MAX_PROMPT_IMAGES) {
      this.logger.warn(`Ticket #${ticketNumber}: ${ids.length} images referenced; sending the first ${MAX_PROMPT_IMAGES}`);
    }
    const images = await this.attachments.loadImages(ids.slice(0, MAX_PROMPT_IMAGES), MAX_PROMPT_IMAGE_BYTES);
    if (images.length === 0) return text;
    this.logger.log(`Ticket #${ticketNumber}: sending ${images.length} image(s) with the prompt`);

    const content: UserContent = [{ type: 'text', text }];
    for (const img of images) {
      // A label per image so the model can match it to its markdown reference.
      content.push({ type: 'text', text: `Image ${img.filename} (/api/attachments/${img.id}):` });
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType as ImageMediaType, data: img.data },
      });
    }
    // Same shape the SDK builds for a string prompt (empty session_id; `resume` picks the session).
    // With in-process MCP servers the SDK keeps stdin open until the run ends, so one message is one turn.
    const message: SDKUserMessage = {
      type: 'user',
      session_id: '',
      parent_tool_use_id: null,
      message: { role: 'user', content },
    };
    return (async function* () {
      yield message;
    })();
  }

  describeResultError(subtype: string, errors?: string[]): string {
    const details = errors && errors.length > 0 ? `: ${truncate(errors.join('; '), 500)}` : '';
    switch (subtype) {
      case 'error_max_turns':
        return `The agent reached the maximum number of turns (${this.config.agentMaxTurns}) without finishing${details}.`;
      case 'error_max_budget_usd':
        return `The agent reached its cost budget without finishing${details}.`;
      case 'error_during_execution':
        return `The agent run failed during execution${details}.`;
      default:
        return `The agent run ended with ${subtype}${details}.`;
    }
  }
}
