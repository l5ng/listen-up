import { OpenAiCompatibleClient } from '@listen-up/agent';

export interface ProviderSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
}

export interface AppSettings {
  provider: ProviderSettings;
  inputPausesWorld: boolean;
  reduceMotion: boolean;
}

export const SETTINGS_KEY = 'listen-up.settings.v1';
export const PROGRESS_KEY = 'listen-up.progress.v1';

export const defaultSettings: AppSettings = {
  provider: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: '',
    temperature: 0.4,
  },
  inputPausesWorld: false,
  reduceMotion: false,
};

export const providerPresets = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return structuredClone(defaultSettings);
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return structuredClone(defaultSettings);
    const provider = isRecord(parsed.provider) ? parsed.provider : {};
    return {
      provider: {
        baseUrl:
          typeof provider.baseUrl === 'string'
            ? provider.baseUrl
            : defaultSettings.provider.baseUrl,
        apiKey: typeof provider.apiKey === 'string' ? provider.apiKey : '',
        model: typeof provider.model === 'string' ? provider.model : '',
        temperature:
          typeof provider.temperature === 'number'
            ? provider.temperature
            : defaultSettings.provider.temperature,
      },
      inputPausesWorld: parsed.inputPausesWorld === true,
      reduceMotion: parsed.reduceMotion === true,
    };
  } catch {
    return structuredClone(defaultSettings);
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or quota: the game still works in memory.
  }
}

export function hasModel(settings: AppSettings): boolean {
  return settings.provider.baseUrl.trim().length > 0 && settings.provider.model.trim().length > 0;
}

export function createClient(settings: AppSettings): OpenAiCompatibleClient {
  const provider = settings.provider;
  return new OpenAiCompatibleClient({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.model,
    temperature: provider.temperature,
  });
}

export interface Progress {
  completed: string[];
  lastLevel?: string;
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return { completed: [] };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { completed: [] };
    return {
      completed: Array.isArray(parsed.completed)
        ? parsed.completed.filter((value): value is string => typeof value === 'string')
        : [],
      lastLevel: typeof parsed.lastLevel === 'string' ? parsed.lastLevel : undefined,
    };
  } catch {
    return { completed: [] };
  }
}

export function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // ignore
  }
}
