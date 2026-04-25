import { describe, it, expect, beforeEach } from 'vitest';
import { setConfig } from '../config.js';
import { extractApiKey, getApiKeyConfig, hasAgentAccess } from './middleware.js';

describe('auth middleware', () => {
  beforeEach(() => {
    // Set up test config
    setConfig({
      gateway: {
        host: '0.0.0.0',
        port: 8080,
        logLevel: 'info',
        corsOrigins: '*',
        requestTimeoutMs: 120000,
      },
      apiKeys: [
        { key: 'pk_dev_default', label: 'dev-key', allowedAgents: '*' },
        { key: 'pk_limited', label: 'limited-key', allowedAgents: ['writing-assistant'] },
      ],
      dataDir: './data',
      agents: [],
    });
  });

  describe('extractApiKey', () => {
    it('should extract API key from Bearer header', () => {
      expect(extractApiKey('Bearer pk_dev_default')).toBe('pk_dev_default');
    });

    it('should handle case-insensitive bearer', () => {
      expect(extractApiKey('bearer pk_dev_default')).toBe('pk_dev_default');
      expect(extractApiKey('BEARER pk_dev_default')).toBe('pk_dev_default');
    });

    it('should return null for missing header', () => {
      expect(extractApiKey(null)).toBeNull();
    });

    it('should return null for invalid header format', () => {
      expect(extractApiKey('InvalidFormat')).toBeNull();
      expect(extractApiKey('Basic abc')).toBeNull();
    });
  });

  describe('getApiKeyConfig', () => {
    it('should return config for valid key', () => {
      const config = getApiKeyConfig('pk_dev_default');
      expect(config).not.toBeNull();
      expect(config?.key).toBe('pk_dev_default');
      expect(config?.label).toBe('dev-key');
    });

    it('should return null for invalid key', () => {
      const config = getApiKeyConfig('invalid_key');
      expect(config).toBeNull();
    });
  });

  describe('hasAgentAccess', () => {
    it('should allow access for wildcard key', () => {
      const wildcardKey = getApiKeyConfig('pk_dev_default')!;
      expect(hasAgentAccess(wildcardKey, 'writing-assistant')).toBe(true);
      expect(hasAgentAccess(wildcardKey, 'any-agent')).toBe(true);
    });

    it('should allow access for allowed agent', () => {
      const limitedKey = getApiKeyConfig('pk_limited')!;
      expect(hasAgentAccess(limitedKey, 'writing-assistant')).toBe(true);
    });

    it('should deny access for disallowed agent', () => {
      const limitedKey = getApiKeyConfig('pk_limited')!;
      expect(hasAgentAccess(limitedKey, 'other-agent')).toBe(false);
    });
  });
});
