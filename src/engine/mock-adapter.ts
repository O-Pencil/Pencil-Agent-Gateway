/**
 * Mock Engine Adapter for Testing
 *
 * [WHO]  Gateway server
 * [FROM] Chat completion routes
 * [TO]  Nothing (this is a mock)
 * [HERE] Test implementation of EngineAdapter
 *
 * v0.2: supports scripted tool_request emission so integration tests can
 * drive the SSE pencil.tool_request -> POST tool_response loop without
 * involving a real engine. See docs/18 §15 M-tools-1.
 */

import {
  type EngineAdapter,
  type EngineRunRequest,
  type EngineRunResult,
  type EngineRunOptions,
  type ToolCallResponse,
} from './adapter.js';

/**
 * One scripted tool call the mock will emit during a run.
 *
 * `replyText` is appended to the streamed response after the tool resolves
 * — it stands in for "the model used the tool result".
 *
 * `consumeOnError`: when set to `'abort'` and the response is `status:'error'`
 * or `status:'cancelled'`, the mock aborts the run with `finishReason:'error'`
 * after consuming the response. Default is to keep streaming `replyText`
 * verbatim regardless of response status — keeps tests simple.
 */
export interface ScriptedToolCall {
  name: string;
  arguments: Record<string, unknown>;
  timeoutMs?: number;
  replyText?: string;
  consumeOnError?: 'abort' | 'continue';
}

/**
 * Mock engine adapter for testing.
 *
 * v0.1 behavior (no scripted tools): emits a default response.
 * v0.2 behavior (scripted tools): for each scripted call, emits
 * tool_request, awaits provideToolResponse, then emits delta text.
 */
export class MockEngineAdapter implements EngineAdapter {
  private responses = new Map<string, string>();
  private scriptedTools = new Map<string, ScriptedToolCall[]>();
  /** id -> resolve/reject for pending tool calls inside run(). */
  private pendingTools = new Map<
    string,
    {
      resolve: (r: ToolCallResponse) => void;
      reject: (e: Error) => void;
    }
  >();
  /** Counter used to mint deterministic-ish tool call ids in tests. */
  private toolCounter = 0;

  constructor() {
    this.responses.set('default', 'This is a mock response from the test engine.');
  }

  /**
   * Set a custom response for an agent.
   */
  setResponse(agentId: string, response: string): void {
    this.responses.set(agentId, response);
  }

  /**
   * Script one or more tool calls to emit during this agent's next run.
   * Calls fire in order; one-shot (cleared after the run consumes them).
   */
  scriptTool(agentId: string, call: ScriptedToolCall): void {
    const list = this.scriptedTools.get(agentId) ?? [];
    list.push(call);
    this.scriptedTools.set(agentId, list);
  }

  /**
   * Clear any scripted tools for an agent.
   */
  clearScript(agentId: string): void {
    this.scriptedTools.delete(agentId);
  }

  /**
   * v0.2 EngineAdapter contract: deliver a tool response into the run loop.
   */
  async provideToolResponse(toolCallId: string, response: ToolCallResponse): Promise<void> {
    const pending = this.pendingTools.get(toolCallId);
    if (!pending) {
      // Idempotent silent return per docs/18 §9.
      return;
    }
    this.pendingTools.delete(toolCallId);
    pending.resolve(response);
  }

  async run(request: EngineRunRequest, options?: EngineRunOptions): Promise<EngineRunResult> {
    const scripted = this.scriptedTools.get(request.agentId) ?? [];
    // One-shot consumption per agent: clear before running so re-entrancy
    // doesn't replay the same script.
    if (scripted.length > 0) {
      this.scriptedTools.delete(request.agentId);
    }

    const baseResponse = this.getResponse(request.agentId);
    const advertisedNames = new Set(
      (request.clientTools ?? []).map((t) => t.name),
    );

    if (options?.stream && options.onDelta) {
      // Stream any scripted tool calls first (serialized — §16 decision 1).
      for (const call of scripted) {
        if (!advertisedNames.has(call.name) && advertisedNames.size > 0) {
          // Behave like a real engine: emit anyway. The chat route will catch
          // the not-advertised case and produce `tool_not_advertised` error.
        }
        const toolCallId = this.mintToolCallId();
        const responsePromise = new Promise<ToolCallResponse>((resolve, reject) => {
          this.pendingTools.set(toolCallId, { resolve, reject });
        });

        options.onDelta({
          type: 'tool_request',
          toolCallId,
          toolName: call.name,
          toolArguments: call.arguments,
          toolTimeoutMs: call.timeoutMs,
        });

        let toolResponse: ToolCallResponse;
        try {
          toolResponse = await responsePromise;
        } catch (err) {
          // Timeout / cancel propagated by Gateway. Surface as error event and stop.
          options.onDelta({
            type: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
          return {
            text: '',
            finishReason: 'error',
            usage: {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
            },
          };
        }

        if (
          call.consumeOnError === 'abort' &&
          (toolResponse.status === 'error' || toolResponse.status === 'cancelled')
        ) {
          options.onDelta({
            type: 'error',
            error:
              toolResponse.status === 'error'
                ? `${toolResponse.error.code}: ${toolResponse.error.message}`
                : 'tool cancelled',
          });
          return {
            text: '',
            finishReason: 'error',
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          };
        }

        const replyText = call.replyText ?? '';
        for (const char of replyText) {
          options.onDelta({ type: 'delta', content: char });
        }
      }

      // Finally stream the base response.
      for (const char of baseResponse) {
        options.onDelta({ type: 'delta', content: char });
      }

      options.onDelta({ type: 'done', finishReason: 'stop' });
    }

    return {
      text: baseResponse,
      finishReason: 'stop',
      usage: {
        promptTokens: request.messages.reduce((sum, m) => sum + m.content.length, 0),
        completionTokens: baseResponse.length,
        totalTokens:
          request.messages.reduce((sum, m) => sum + m.content.length, 0) + baseResponse.length,
      },
    };
  }

  private getResponse(agentId: string): string {
    return this.responses.get(agentId) ?? this.responses.get('default') ?? 'Mock response';
  }

  private mintToolCallId(): string {
    this.toolCounter += 1;
    return `tc_mock_${this.toolCounter.toString().padStart(6, '0')}`;
  }
}
