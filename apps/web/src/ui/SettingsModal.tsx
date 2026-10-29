import { useEffect, useState } from 'react';
import { Check, Eye, EyeOff, LoaderCircle, X } from 'lucide-react';
import type { AppSettings } from '../app/settings';
import { createClient, defaultSettings, hasModel, providerPresets } from '../app/settings';
import { copy } from '../copy';

interface SettingsModalProps {
  open: boolean;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
  inGame?: boolean;
}

export function SettingsModal({
  open,
  settings,
  onSave,
  onClose,
  inGame = false,
}: SettingsModalProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setTestResult(undefined);
      setError(undefined);
    }
  }, [open, settings]);

  if (!open) return null;

  const updateProvider = (patch: Partial<AppSettings['provider']>) => {
    setDraft((current) => ({ ...current, provider: { ...current.provider, ...patch } }));
    setTestResult(undefined);
  };

  const testConnection = async () => {
    if (!hasModel(draft)) {
      setTestResult({ ok: false, message: '先填写 Base URL 和模型名。' });
      return;
    }
    setTesting(true);
    setTestResult(undefined);
    try {
      const models = await createClient(draft).listModels();
      setTestResult({
        ok: true,
        message:
          models.length > 0
            ? `连接成功，读到 ${models.length} 个模型。`
            : '连接成功。这个端点没有返回模型列表，但请求可达。',
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setTestResult({
        ok: false,
        message: `${message} 浏览器直连还可能被服务商的 CORS 策略拦截。`,
      });
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    if (!draft.provider.baseUrl.trim()) {
      setError('Base URL 不能为空。');
      return;
    }
    try {
      const url = new URL(draft.provider.baseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
    } catch {
      setError('Base URL 必须是 http:// 或 https:// 地址。');
      return;
    }
    if (!draft.provider.model.trim()) {
      setError('模型名不能为空。');
      return;
    }
    setError(undefined);
    onSave({
      ...draft,
      provider: {
        ...draft.provider,
        baseUrl: draft.provider.baseUrl.trim(),
        model: draft.provider.model.trim(),
        apiKey: draft.provider.apiKey.trim(),
      },
    });
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="settings-scroll">
          <div className="row spread">
            <div>
              <h2 id="settings-title">{copy.settings}</h2>
              <div className="muted">
                只支持 OpenAI Chat Completions 格式，模型需要支持 tool calling。
              </div>
            </div>
            <button className="btn icon-only ghost" onClick={onClose} aria-label={copy.close}>
              <X size={20} />
            </button>
          </div>

          <h3>{copy.modelSection}</h3>
          <div className="preset-row">
            {providerPresets.map((preset) => (
              <button
                key={preset.id}
                className="btn small ghost"
                onClick={() => updateProvider({ baseUrl: preset.baseUrl })}
                type="button"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="field">
            <label htmlFor="base-url">Base URL</label>
            <input
              id="base-url"
              value={draft.provider.baseUrl}
              onChange={(event) => updateProvider({ baseUrl: event.target.value })}
              placeholder="https://api.openai.com/v1"
              autoComplete="url"
              spellCheck={false}
            />
            <span className="hint">
              一般以 /v1 结尾。请求会发到 {'{baseUrl}'}/chat/completions。
            </span>
          </div>

          <div className="field">
            <label htmlFor="api-key">API Key</label>
            <div className="row">
              <input
                id="api-key"
                value={draft.provider.apiKey}
                onChange={(event) => updateProvider({ apiKey: event.target.value })}
                type={showKey ? 'text' : 'password'}
                placeholder="sk-..."
                autoComplete="off"
                spellCheck={false}
              />
              <button
                className="btn icon-only ghost"
                type="button"
                onClick={() => setShowKey((value) => !value)}
                aria-label={showKey ? '隐藏密钥' : '显示密钥'}
              >
                {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <span className="hint">{copy.privacy}</span>
            {draft.provider.apiKey ? (
              <button
                className="btn small ghost"
                type="button"
                onClick={() => updateProvider({ apiKey: '' })}
                style={{ justifySelf: 'start' }}
              >
                {copy.clearKey}
              </button>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="model-name">模型名</label>
            <input
              id="model-name"
              value={draft.provider.model}
              onChange={(event) => updateProvider({ model: event.target.value })}
              placeholder="例如 deepseek-chat、gpt-4o-mini 或 qwen3:8b"
              spellCheck={false}
            />
            <span className="hint">必须支持 OpenAI tools / function calling。模型名不会写死。</span>
          </div>

          <div className="field">
            <label htmlFor="temperature">
              Temperature：{draft.provider.temperature.toFixed(1)}
            </label>
            <input
              id="temperature"
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={draft.provider.temperature}
              onChange={(event) => updateProvider({ temperature: Number(event.target.value) })}
            />
          </div>

          <div className="row">
            <button className="btn small" type="button" onClick={testConnection} disabled={testing}>
              {testing ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
              {copy.test}
            </button>
            {inGame ? <span className="muted">进行中的关卡会在重新进入后使用新设置。</span> : null}
          </div>
          {testResult ? (
            <div className={`test-result ${testResult.ok ? 'ok' : 'error'}`}>
              {testResult.message}
            </div>
          ) : null}
          {error ? <div className="test-result error">{error}</div> : null}

          <h3>{copy.gameSection}</h3>
          <div className="check-row">
            <div>
              <strong>{copy.inputPause}</strong>
              <div className="muted">打开输入框时冻结世界，方便慢慢组织中文指令。</div>
            </div>
            <input
              type="checkbox"
              checked={draft.inputPausesWorld}
              onChange={(event) =>
                setDraft((current) => ({ ...current, inputPausesWorld: event.target.checked }))
              }
              aria-label={copy.inputPause}
            />
          </div>
          <div className="check-row">
            <div>
              <strong>{copy.reduceMotion}</strong>
              <div className="muted">降低镜头跟随的平滑幅度，减少晃动。</div>
            </div>
            <input
              type="checkbox"
              checked={draft.reduceMotion}
              onChange={(event) =>
                setDraft((current) => ({ ...current, reduceMotion: event.target.checked }))
              }
              aria-label={copy.reduceMotion}
            />
          </div>
        </div>

        <div className="settings-footer">
          <span className="settings-footer-note">改完记得保存</span>
          <div className="row">
            <button
              className="btn ghost"
              onClick={() => setDraft(structuredClone(defaultSettings))}
              type="button"
            >
              恢复默认
            </button>
            <button className="btn primary" onClick={save} type="button">
              {copy.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
