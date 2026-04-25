import { describe, it, expect } from 'vitest';
import {
  generateChatId,
  validateChatRequest,
  type ChatCompletionRequest,
} from './types.js';

describe('OpenAI protocol types', () => {
  describe('generateChatId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateChatId();
      const id2 = generateChatId();
      expect(id1).toMatch(/^chatcmpl_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^chatcmpl_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('validateChatRequest', () => {
    it('should pass valid request', () => {
      const request: ChatCompletionRequest = {
        model: 'pencil/test-agent',
        messages: [{ role: 'user', content: 'Hello' }],
      };
      const errors = validateChatRequest(request);
      expect(errors).toHaveLength(0);
    });

    it('should reject missing model', () => {
      const request = {
        messages: [{ role: 'user', content: 'Hello' }],
      } as ChatCompletionRequest;
      const errors = validateChatRequest(request);
      expect(errors).toContain('model is required');
    });

    it('should reject empty messages', () => {
      const request: ChatCompletionRequest = {
        model: 'pencil/test-agent',
        messages: [],
      };
      const errors = validateChatRequest(request);
      expect(errors).toContain('messages must not be empty');
    });

    it('should reject n != 1', () => {
      const request: ChatCompletionRequest = {
        model: 'pencil/test-agent',
        messages: [{ role: 'user', content: 'Hello' }],
        n: 2,
      };
      const errors = validateChatRequest(request);
      expect(errors).toContain('n must be 1 (only single response is supported in v0.1)');
    });

    it('should reject JSON mode', () => {
      const request: ChatCompletionRequest = {
        model: 'pencil/test-agent',
        messages: [{ role: 'user', content: 'Hello' }],
        response_format: { type: 'json_object' },
      };
      const errors = validateChatRequest(request);
      expect(errors).toContain('response_format.type must be "text" (JSON mode not supported in v0.1)');
    });

    it('should accept response_format text', () => {
      const request: ChatCompletionRequest = {
        model: 'pencil/test-agent',
        messages: [{ role: 'user', content: 'Hello' }],
        response_format: { type: 'text' },
      };
      const errors = validateChatRequest(request);
      expect(errors).toHaveLength(0);
    });

    it('should accept n = 1', () => {
      const request: ChatCompletionRequest = {
        model: 'pencil/test-agent',
        messages: [{ role: 'user', content: 'Hello' }],
        n: 1,
      };
      const errors = validateChatRequest(request);
      expect(errors).toHaveLength(0);
    });

    it('should accept session_id extension', () => {
      const request: ChatCompletionRequest = {
        model: 'pencil/test-agent',
        messages: [{ role: 'user', content: 'Hello' }],
        session_id: 'test-session',
      };
      const errors = validateChatRequest(request);
      expect(errors).toHaveLength(0);
    });

    it('should accept system, user, and assistant messages', () => {
      const request: ChatCompletionRequest = {
        model: 'pencil/test-agent',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ],
      };
      const errors = validateChatRequest(request);
      expect(errors).toHaveLength(0);
    });
  });
});
