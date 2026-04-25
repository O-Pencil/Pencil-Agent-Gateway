/**
 * Mock Engine Adapter for Testing
 *
 * [WHO]  Gateway server
 * [FROM] Chat completion routes
 * [TO]  Nothing (this is a mock)
 * [HERE] Test implementation of EngineAdapter
 */

import {
  type EngineAdapter,
  type EngineRunRequest,
  type EngineRunResult,
  type EngineRunOptions,
} from './adapter.js';

/**
 * Mock engine adapter for testing
 * Generates simple responses without calling real models
 */
export class MockEngineAdapter implements EngineAdapter {
  private responses: Map<string, string>;

  constructor() {
    this.responses = new Map();
    // Default responses
    this.responses.set('default', 'This is a mock response from the test engine.');
  }

  /**
   * Set a custom response for an agent
   */
  setResponse(agentId: string, response: string): void {
    this.responses.set(agentId, response);
  }

  async run(request: EngineRunRequest, options?: EngineRunOptions): Promise<EngineRunResult> {
    // Simulate streaming if requested
    if (options?.stream && options.onDelta) {
      const response = this.getResponse(request.agentId);
      const chars = response.split('');

      for (const char of chars) {
        options.onDelta({
          type: 'delta',
          content: char,
        });
        // Simulate network delay
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      options.onDelta({
        type: 'done',
        finishReason: 'stop',
      });
    }

    return {
      text: this.getResponse(request.agentId),
      finishReason: 'stop',
      usage: {
        promptTokens: request.messages.reduce((sum, m) => sum + m.content.length, 0),
        completionTokens: this.getResponse(request.agentId).length,
        totalTokens:
          request.messages.reduce((sum, m) => sum + m.content.length, 0) +
          this.getResponse(request.agentId).length,
      },
    };
  }

  private getResponse(agentId: string): string {
    return this.responses.get(agentId) || this.responses.get('default') || 'Mock response';
  }
}
