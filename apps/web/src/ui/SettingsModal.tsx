import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { AppSettings } from '../app/settings';
import { createClient, defaultSettings, hasModel, providerPresets } from '../app/settings';
import { copy } from '../copy';

interface SettingsModalProps {
  open: boolean;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
  onTryDemo?: () => void;
  inGame?: boolean;
}

type ProviderPreset = (typeof providerPresets)[number];

function isLocalUrl(value: string): boolean {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\./.test(
    value,
  );
}

export function SettingsModal({
  open,
  settings,
  onSave,
  onClose,
  onTryDemo,
  inGame = false,
}: SettingsModalProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | undefined>();
  const [error, setError] = useState<string | undefined>();
  const resultRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      const preset = providerPresets.find((entry) => entry.baseUrl === settings.provider.baseUrl);
      const next =
        preset && !settings.provider.model.trim()
          ? { ...settings, provider: { ...settings.provider, model: preset.model } }
          : settings;
      setDraft(next);
      setTestResult(undefined);
      setError(undefined);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      modalRef.current?.focus({ preventScroll: true });
    }
  }, [open, settings]);

  useEffect(() => {
    if (testResult) resultRef.current?.scrollIntoView({ block: 'nearest' });
  }, [testResult]);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  if (!open) return null;

  const updateProvider = (patch: Partial<AppSettings['provider']>) => {
    setDraft((current) => ({ ...current, provider: { ...current.provider, ...patch } }));
    setTestResult(undefined);
    setError(undefined);
  };

  const applyPreset = (preset: ProviderPreset) => {
    setDraft((current) => ({
      ...current,
      provider: {
        ...current.provider,
        baseUrl: preset.baseUrl,
        model: preset.model,
      },
    }));
    setTestResult(undefined);
    setError(undefined);
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

  const local = isLocalUrl(draft.provider.baseUrl);
  const connectView = !inGame && !hasModel(settings);

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
    if (!local && !draft.provider.apiKey.trim()) {
      setError('云端服务需要 API key；本地 Ollama 可以留空。');
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
        className={`modal settings-modal ${connectView ? 'connect-modal' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="settings-scroll" ref={scrollRef}>
          <div className="row spread">
            <div>
              <h2 id="settings-title">{connectView ? copy.connectTitle : copy.settings}</h2>
              <div className="muted">
                {connectView
                  ? copy.connectLead
                  : '只支持 OpenAI Chat Completions 格式，模型需要支持 tool calling。'}
              </div>
            </div>
            <button className="btn icon-only ghost" onClick={onClose} aria-label={copy.close}>
              <X size={20} />
            </button>
          </div>

          {connectView ? (
            <div className="connect-why">
              <span className="connect-why-icon">
                <KeyRound size={20} />
              </span>
              <div>
                <strong>{copy.connectWhyTitle}</strong>
                <p>{copy.connectWhy}</p>
              </div>
            </div>
          ) : null}

          <div className="provider-cards">
            {providerPresets.map((preset) => {
              const active = preset.baseUrl === draft.provider.baseUrl;
              return (
                <div className={`provider-card ${active ? 'active' : ''}`} key={preset.id}>
                  <button
                    className="provider-select"
                    type="button"
                    onClick={() => applyPreset(preset)}
                    aria-pressed={active}
                  >
                    <span className="provider-head">
                      <strong>{preset.label}</strong>
                      {preset.recommended ? (
                        <span className="provider-badge">{copy.connectRecommended}</span>
                      ) : null}
                    </span>
                    <span className="provider-note">{preset.note}</span>
                    <span className="provider-model">{preset.model || '自定义模型'}</span>
                  </button>
                  <a
                    className="provider-link"
                    href={preset.keyUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {preset.id === 'ollama' ? copy.connectInstall : copy.connectGetKey}
                    <ExternalLink size={12} />
                  </a>
                </div>
              );
            })}
          </div>

          <div className="connect-trust">
            <span>
              <ShieldCheck size={14} />
              {copy.connectTrustStored}
            </span>
            <span>
              <KeyRound size={14} />
              {copy.connectTrustEndpoint}
            </span>
            <span>{copy.connectTrustNoAccount}</span>
            <span>{copy.connectTrustRevoke}</span>
          </div>

          <div className="field">
            <label htmlFor="api-key">API Key</label>
            <div className="row">
              <input
                id="api-key"
                value={draft.provider.apiKey}
                onChange={(event) => updateProvider({ apiKey: event.target.value })}
                type={showKey ? 'text' : 'password'}
                placeholder={local ? '本地模型可以留空' : 'sk-...'}
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
            <span className="hint">{local ? '本地模型通常不需要 key。' : copy.privacy}</span>
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
            <div className="row">
              <input
                id="model-name"
                value={draft.provider.model}
                onChange={(event) => updateProvider({ model: event.target.value })}
                placeholder="例如 deepseek-chat、gpt-4o-mini 或 qwen3:8b"
                spellCheck={false}
              />
              <button
                className="btn small connect-test-btn"
                type="button"
                onClick={testConnection}
                disabled={testing}
              >
                {testing ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
                {copy.test}
              </button>
            </div>
            <span className="hint">{copy.connectModelHint}</span>
            {testResult ? (
              <div className={`test-result ${testResult.ok ? 'ok' : 'error'}`} ref={resultRef}>
                {testResult.message}
              </div>
            ) : null}
            {error ? (
              <div className="test-result error" ref={errorRef}>
                {error}
              </div>
            ) : null}
          </div>

          <p className="connect-cost">{copy.connectCost}</p>
          {local ? <p className="connect-cost">{copy.connectLocalHint}</p> : null}

          <details className="connect-advanced">
            <summary>{copy.connectAdvanced}</summary>
            <div className="field">
              <label htmlFor="base-url">接口地址（Base URL）</label>
              <input
                id="base-url"
                value={draft.provider.baseUrl}
                onChange={(event) => updateProvider({ baseUrl: event.target.value })}
                placeholder="https://api.deepseek.com/v1"
                autoComplete="url"
                spellCheck={false}
              />
              <span className="hint">{copy.connectBaseHint}</span>
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
              <span className="hint">越低越稳定，越高越发散。默认 0.4。</span>
            </div>
            {inGame ? (
              <>
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
                      setDraft((current) => ({
                        ...current,
                        inputPausesWorld: event.target.checked,
                      }))
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
              </>
            ) : null}
          </details>
        </div>

        <div className="settings-footer">
          <div className="settings-footer-left">
            {connectView && onTryDemo ? (
              <button className="btn small ghost connect-demo" type="button" onClick={onTryDemo}>
                <ArrowRight size={15} />
                {copy.connectFallback}
              </button>
            ) : null}
            <span className="settings-footer-note">
              {connectView
                ? copy.connectSaved
                : inGame
                  ? '进行中的关卡会在重新进入后使用新设置。'
                  : '改完记得保存'}
            </span>
          </div>
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
