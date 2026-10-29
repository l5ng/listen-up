// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { OpenAiCompatibleClient, OpenAiResponsesClient } from '@listen-up/agent';
import type { AppSettings } from './settings';
import {
  createClient,
  defaultSettings,
  loadSettings,
  providerPresets,
  saveSettings,
  SETTINGS_KEY,
} from './settings';

beforeEach(() => {
  localStorage.clear();
});

function settingsWith(protocol: 'chat' | 'responses'): AppSettings {
  return {
    ...structuredClone(defaultSettings),
    provider: {
      ...defaultSettings.provider,
      baseUrl: 'https://example.test/v1',
      model: 'test-model',
      protocol,
    },
  };
}

describe('provider settings', () => {
  it('defaults to Chat Completions', () => {
    expect(defaultSettings.provider.protocol).toBe('chat');
    expect(loadSettings().provider.protocol).toBe('chat');
  });

  it('migrates settings written before the protocol field existed', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        provider: {
          baseUrl: 'https://api.deepseek.com/v1',
          apiKey: 'key',
          model: 'deepseek-chat',
          temperature: 0.4,
        },
        inputPausesWorld: false,
        reduceMotion: false,
      }),
    );
    expect(loadSettings().provider.protocol).toBe('chat');
  });

  it('persists Responses and rejects unknown protocol values', () => {
    saveSettings(settingsWith('responses'));
    expect(loadSettings().provider.protocol).toBe('responses');

    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ provider: { ...defaultSettings.provider, protocol: 'grpc' } }),
    );
    expect(loadSettings().provider.protocol).toBe('chat');
  });

  it('uses Responses for OpenAI and Chat Completions for the other presets', () => {
    const byId = new Map(providerPresets.map((preset) => [preset.id, preset]));
    expect(byId.get('openai')?.protocol).toBe('responses');
    expect(byId.get('deepseek')?.protocol).toBe('chat');
    expect(byId.get('ollama')?.protocol).toBe('chat');
  });

  it('creates the client matching the selected protocol', () => {
    expect(createClient(settingsWith('chat'))).toBeInstanceOf(OpenAiCompatibleClient);
    expect(createClient(settingsWith('responses'))).toBeInstanceOf(OpenAiResponsesClient);
  });
});
