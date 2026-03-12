import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.DB_PATH = ':memory:';
process.env.ZEN_KEYS = 'sk-' + 'z'.repeat(60);

const { resolveProvider } = await import('../src/proxy.js');

describe('resolveProvider integration', () => {
  describe('aido/* paths', () => {
    it('routes /aido/auto/v1/chat/completions to auto mode', () => {
      const result = resolveProvider('/aido/auto/v1/chat/completions');
      expect(result.provider).toBe('auto');
      expect(result.isAidoAuto).toBe(true);
    });

    it('routes /aido/cloud/v1/chat/completions to zen (default cloud)', () => {
      const result = resolveProvider('/aido/cloud/v1/chat/completions');
      expect(result.provider).toBe('zen');
      expect(result.isAidoAuto).toBe(true);
    });

    it('routes /aido/cloud/big-pickle/v1/chat/completions to zen with model', () => {
      const result = resolveProvider('/aido/cloud/big-pickle/v1/chat/completions');
      expect(result.provider).toBe('zen');
      expect(result.model).toBe('big-pickle');
      expect(result.isAidoAuto).toBe(false);
    });

    it('routes /aido/local/v1/chat/completions to ollama-local', () => {
      const result = resolveProvider('/aido/local/v1/chat/completions');
      expect(result.provider).toBe('ollama-local');
      expect(result.isAidoAuto).toBe(true);
    });

    it('routes /aido/local/qwen3:8b/v1/chat/completions to ollama-local with model', () => {
      const result = resolveProvider('/aido/local/qwen3:8b/v1/chat/completions');
      expect(result.provider).toBe('ollama-local');
      expect(result.model).toBe('qwen3:8b');
      expect(result.isAidoAuto).toBe(false);
    });

    it('routes /aido/zen/big-pickle/v1/chat/completions to zen', () => {
      const result = resolveProvider('/aido/zen/big-pickle/v1/chat/completions');
      expect(result.provider).toBe('zen');
      expect(result.model).toBe('big-pickle');
      expect(result.isAidoAuto).toBe(false);
    });

    it('routes /aido/ollama/glm-5:cloud/v1/chat/completions to ollama', () => {
      const result = resolveProvider('/aido/ollama/glm-5:cloud/v1/chat/completions');
      expect(result.provider).toBe('ollama');
      expect(result.model).toBe('glm-5:cloud');
      expect(result.isAidoAuto).toBe(false);
    });

    it('routes /aido/openai/gpt-4o-mini/v1/chat/completions to openai', () => {
      const result = resolveProvider('/aido/openai/gpt-4o-mini/v1/chat/completions');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o-mini');
      expect(result.isAidoAuto).toBe(false);
    });

    it('routes /aido/groq/llama3-8b-8192/v1/chat/completions to groq', () => {
      const result = resolveProvider('/aido/groq/llama3-8b-8192/v1/chat/completions');
      expect(result.provider).toBe('groq');
      expect(result.model).toBe('llama3-8b-8192');
      expect(result.isAidoAuto).toBe(false);
    });

    it('routes /aido/anthropic/claude-haiku-4-5/v1/chat/completions to anthropic', () => {
      const result = resolveProvider('/aido/anthropic/claude-haiku-4-5/v1/chat/completions');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-haiku-4-5');
      expect(result.isAidoAuto).toBe(false);
    });
  });

  describe('legacy paths still work', () => {
    it('routes /auto/v1/chat/completions to auto', () => {
      const result = resolveProvider('/auto/v1/chat/completions');
      expect(result.provider).toBe('auto');
    });

    it('routes /zen/v1/chat/completions to zen', () => {
      const result = resolveProvider('/zen/v1/chat/completions');
      expect(result.provider).toBe('zen');
    });

    it('routes /ollama-local/v1/chat/completions to ollama-local', () => {
      const result = resolveProvider('/ollama-local/v1/chat/completions');
      expect(result.provider).toBe('ollama-local');
    });

    it('routes /ollama/v1/chat/completions to ollama', () => {
      const result = resolveProvider('/ollama/v1/chat/completions');
      expect(result.provider).toBe('ollama');
    });

    it('routes /v1/chat/completions to default provider (zen)', () => {
      const result = resolveProvider('/v1/chat/completions');
      expect(result.provider).toBe('zen');
    });
  });

  describe('error paths', () => {
    it('throws for invalid aido path', () => {
      expect(() => resolveProvider('/aido/unknown/v1/chat/completions')).toThrow();
    });

    it('throws for missing model in provider path', () => {
      expect(() => resolveProvider('/aido/zen/v1/chat/completions')).toThrow();
    });
  });
});
