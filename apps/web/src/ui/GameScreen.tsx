import { useProgress } from '@react-three/drei';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Flag,
  Keyboard,
  Lightbulb,
  ListTree,
  LoaderCircle,
  MessageCircle,
  Pause,
  Play,
  RotateCcw,
  Send,
  Settings,
  X,
} from 'lucide-react';
import { GameSession } from '@listen-up/game';
import type { LevelDef } from '@listen-up/sim';
import { COMPANION_NAME, PLAYER_NAME } from '@listen-up/sim';
import type { AppSettings } from '../app/settings';
import { createClient } from '../app/settings';
import { copy } from '../copy';
import { createInputState } from '../game/input';
import { GameCanvas } from '../game/GameCanvas';
import { TraceDrawer } from './TraceDrawer';

interface GameScreenProps {
  level: LevelDef;
  settings: AppSettings;
  onExit: () => void;
  onOpenSettings: () => void;
  onComplete: (levelId: string) => void;
  onNext: () => void;
  reduceMotion: boolean;
  /** True while a parent-level modal (settings/credits/prologue) is open. */
  suspended: boolean;
}

const examples: Record<string, string> = {
  'sky-01': '把木箱往南推下去给我垫脚。',
  'sky-02': '等我踩上蓝色机关，你再朝旗门走。',
  'sky-03': '站到红色机关上，等我穿过闸门。',
};

function ControlsGrid() {
  return (
    <div className="controls">
      <span>
        <b>W A S D</b> 移动 {PLAYER_NAME}
      </span>
      <span>
        <b>Space</b> 跳跃
      </span>
      <span>
        <b>E</b> 拉杆
      </span>
      <span>
        <b>Enter</b> 对 {COMPANION_NAME} 说话
      </span>
      <span>
        <b>鼠标拖动</b> 环绕镜头
      </span>
      <span>
        <b>滚轮</b> 缩放
      </span>
      <span>
        <b>按住 Q</b> 看 {COMPANION_NAME}
      </span>
      <span>
        <b>Tab</b> 行动记录
      </span>
      <span>
        <b>P / Esc</b> 暂停
      </span>
      <span>
        <b>H</b> 帮助与键位
      </span>
    </div>
  );
}

export function GameScreen({
  level,
  settings,
  onExit,
  onOpenSettings,
  onComplete,
  onNext,
  reduceMotion,
  suspended,
}: GameScreenProps) {
  const createSession = useCallback(
    () =>
      new GameSession({
        level,
        client: createClient(settings),
        model: settings.provider.model,
        temperature: settings.provider.temperature,
        maxSteps: 12,
      }),
    [level, settings],
  );
  const [session, setSession] = useState<GameSession>(createSession);
  const input = useMemo(() => createInputState(), []);
  const [typing, setTyping] = useState(false);
  const [paused, setPaused] = useState(false);
  const [introOpen, setIntroOpen] = useState(true);
  const [hintOpen, setHintOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [text, setText] = useState('');
  const [notice, setNotice] = useState<string | undefined>();
  const [sentCount, setSentCount] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reported = useRef(false);
  const ui = useSyncExternalStore(session.subscribe, session.getUiSnapshot);
  const { active: assetsLoading, progress: assetProgress } = useProgress();

  useEffect(() => {
    if (import.meta.env.DEV) window.listenupSession = session;
  }, [session]);

  useEffect(() => {
    const detach = input.attach();
    return () => {
      detach();
    };
  }, [input]);

  useEffect(() => {
    return () => {
      session.dispose();
    };
  }, [session]);

  useEffect(() => {
    session.setPaused(
      paused || suspended || introOpen || hintOpen || (settings.inputPausesWorld && typing),
    );
  }, [session, paused, suspended, introOpen, hintOpen, typing, settings.inputPausesWorld]);

  useEffect(() => {
    if (ui.status === 'won' && !reported.current) {
      reported.current = true;
      onComplete(level.id);
    }
  }, [ui.status, level.id, onComplete]);

  useEffect(() => {
    if (!notice) return;
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(undefined), 2400);
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, [notice]);

  const canControl =
    !paused && !suspended && !introOpen && !hintOpen && !typing && ui.status === 'playing';

  const send = (value?: string) => {
    const clean = (value ?? text).trim();
    if (!clean) return;
    session.say(clean);
    setText('');
    setSentCount((count) => count + 1);
    textareaRef.current?.blur();
  };

  const startWithExample = (value: string) => {
    setIntroOpen(false);
    setText(value);
    window.setTimeout(() => send(value), 80);
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // A parent-level modal is open: it owns the keyboard (e.g. Escape closes
      // the settings dialog), and the paused world must not react to hotkeys.
      if (suspended) return;
      // Ignore plain game hotkeys while the user is chord-ing browser shortcuts.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const active = document.activeElement;
      const inText = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement;
      if (event.key === 'Escape') {
        if (inText) {
          textareaRef.current?.blur();
          return;
        }
        if (traceOpen) {
          setTraceOpen(false);
          return;
        }
        if (introOpen || hintOpen) {
          setIntroOpen(false);
          setHintOpen(false);
          return;
        }
        setPaused((value) => !value);
        return;
      }
      if (event.key === 'Tab' && !inText) {
        event.preventDefault();
        setTraceOpen((value) => !value);
        return;
      }
      if (
        event.key === 'Enter' &&
        !inText &&
        !paused &&
        !introOpen &&
        !hintOpen &&
        ui.status === 'playing'
      ) {
        event.preventDefault();
        textareaRef.current?.focus();
        return;
      }
      if (event.code === 'KeyH' && !inText && !paused && !introOpen && ui.status === 'playing') {
        event.preventDefault();
        setHintOpen((value) => !value);
        return;
      }
      if (event.code === 'KeyP' && !inText && !introOpen && ui.status === 'playing') {
        setPaused((value) => !value);
        return;
      }
      if (event.code === 'KeyE' && canControl && !event.repeat) {
        const message = session.interact();
        if (message) setNotice(message);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canControl, hintOpen, introOpen, paused, session, suspended, traceOpen, ui.status]);

  const restart = () => {
    const next = createSession();
    session.dispose();
    setSession(next);
    reported.current = false;
    setSentCount(0);
    setPaused(false);
    setIntroOpen(true);
    setTraceOpen(false);
    setText('');
    setNotice(undefined);
  };

  const toolCount = ui.trace.filter((entry) => entry.kind === 'tool').length;
  const example = examples[level.id] ?? `告诉 ${COMPANION_NAME} 你想让它做什么。`;

  return (
    <div className="game-root">
      <GameCanvas
        session={session}
        level={level}
        input={input}
        paused={paused || introOpen || hintOpen}
        canControl={canControl}
        reduceMotion={reduceMotion}
      />
      <div className="hud">
        <div className="objective-card">
          <div className="objective-label">
            <Flag size={15} />
            {copy.objective}
          </div>
          <div className="objective-text">{level.goal}</div>
        </div>
        <div className="level-chip">{level.name}</div>
        <div className="top-actions">
          <button
            className="btn ghost help-btn"
            onClick={() => setHintOpen(true)}
            aria-label={copy.help}
            title="帮助与键位（H）"
          >
            <Keyboard size={18} />
            <span>{copy.helpShort}</span>
          </button>
          <button
            className="btn icon-only ghost"
            onClick={() => setTraceOpen((value) => !value)}
            aria-label="行动记录"
            title="行动记录（Tab）"
          >
            <ListTree size={20} />
          </button>
          <button
            className="btn icon-only ghost"
            onClick={() => setPaused((value) => !value)}
            aria-label="暂停"
            title="暂停（P）"
          >
            {paused ? <Play size={20} /> : <Pause size={20} />}
          </button>
          <button
            className="btn icon-only ghost"
            onClick={() => {
              onOpenSettings();
            }}
            aria-label="设置"
            title="设置"
          >
            <Settings size={20} />
          </button>
        </div>

        <div className="b-status">
          {ui.turnActive ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <MessageCircle size={16} />
          )}
          <span>{COMPANION_NAME}</span>
          <strong>{ui.bStatus}</strong>
        </div>

        <div className="chat-dock">
          {ui.rules.length > 0 ? (
            <div className="rules-strip">
              <span className="rules-label">
                <Check size={12} />
                {copy.rules}
              </span>
              {ui.rules.map((rule) => (
                <span className="rule-chip" key={rule.id}>
                  {rule.text}
                  <button
                    onClick={() => session.removeRule(rule.id)}
                    aria-label={`删除规则 ${rule.text}`}
                    type="button"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="input-shell">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(event) => setText(event.target.value.slice(0, 600))}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder={copy.placeholder}
              aria-label={`告诉 ${COMPANION_NAME} 要做什么`}
              spellCheck={false}
            />
            <button
              className="send-btn"
              onClick={() => send()}
              disabled={!text.trim()}
              aria-label={copy.send}
              type="button"
            >
              <Send size={21} />
            </button>
          </div>
          <div className="input-hint">
            <span>Enter 发送 · Shift+Enter 换行</span>
            <span>Tab 行动记录 · E 互动 · Q 看 {COMPANION_NAME}</span>
          </div>
        </div>

        {ui.agentError ? (
          <div className="error-banner" role="alert">
            <AlertTriangle size={18} />
            <span>{ui.agentError.message}</span>
            <span className="spacer" />
            <button className="btn small" type="button" onClick={() => session.retry()}>
              {copy.retry}
            </button>
            <button
              className="btn small ghost"
              type="button"
              onClick={() => {
                onOpenSettings();
              }}
            >
              {copy.settings}
            </button>
          </div>
        ) : null}

        {notice ? <div className="notice-pill">{notice}</div> : null}
      </div>

      <TraceDrawer ui={ui} open={traceOpen} onClose={() => setTraceOpen(false)} />
      <div className="sr-only" aria-live="polite">
        {ui.speech}
      </div>
      {assetsLoading ? (
        <div className="loading-screen" role="status">
          <LoaderCircle size={28} className="spin" />
          <span>正在搭建浮岛 {Math.round(assetProgress)}%</span>
        </div>
      ) : null}

      {introOpen ? (
        <div className="overlay">
          <div className="panel">
            <h2>{level.summary}</h2>
            <div className="goal">{level.goal}</div>
            <div className="example-line">
              <span>可以这样对 {COMPANION_NAME} 说：</span>
              <button
                className="example-chip"
                type="button"
                onClick={() => startWithExample(example)}
                aria-label={`${copy.exampleCta}：${example}`}
                title={copy.exampleCta}
              >
                <MessageCircle size={15} />
                {example}
                <Send size={14} />
              </button>
            </div>
            <ControlsGrid />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button className="btn ghost" type="button" onClick={() => setHintOpen(true)}>
                <Lightbulb size={17} />
                {copy.hint}
              </button>
              <button className="btn primary" type="button" onClick={() => setIntroOpen(false)}>
                <Play size={18} />
                {copy.introStart}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {hintOpen ? (
        <div className="overlay">
          <div className="panel">
            <h2>{copy.help}</h2>
            <p className="muted">随时按 H 打开这里。</p>
            <h3>键位</h3>
            <ControlsGrid />
            <h3>本关提示</h3>
            <ol style={{ lineHeight: 1.8, paddingLeft: 20 }}>
              {level.hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ol>
            <div className="modal-actions">
              <button className="btn primary" type="button" onClick={() => setHintOpen(false)}>
                知道了
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {paused && !introOpen && !hintOpen ? (
        <div className="overlay">
          <div className="panel">
            <h2>{copy.pause}</h2>
            <p className="muted">{COMPANION_NAME} 会停在这里，等你回来。</p>
            <div className="stack">
              <button className="btn primary" type="button" onClick={() => setPaused(false)}>
                <Play size={18} />
                {copy.resume}
              </button>
              <button className="btn leaf" type="button" onClick={restart}>
                <RotateCcw size={18} />
                {copy.restart}
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  onOpenSettings();
                }}
              >
                <Settings size={18} />
                {copy.settings}
              </button>
              <button className="btn ghost" type="button" onClick={onExit}>
                <ArrowLeft size={18} />
                {copy.levelSelect}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {ui.status === 'won' ? (
        <div className="overlay">
          <div className="panel">
            <div className="row" style={{ gap: 10 }}>
              <span className="level-index">
                <Check size={22} />
              </span>
              <h2 style={{ margin: 0 }}>{copy.completed}</h2>
            </div>
            <p className="muted">{level.name}</p>
            <div className="win-stats">
              <div className="stat">
                <strong>{sentCount}</strong>
                <span>玩家指令</span>
              </div>
              <div className="stat">
                <strong>{toolCount}</strong>
                <span>{COMPANION_NAME} 的动作</span>
              </div>
              <div className="stat">
                <strong>{ui.promptTokens + ui.completionTokens}</strong>
                <span>tokens</span>
              </div>
            </div>
            <div className="stack">
              <button className="btn primary" type="button" onClick={onNext}>
                <ChevronRight size={18} />
                {copy.next}
              </button>
              <button className="btn ghost" type="button" onClick={restart}>
                <RotateCcw size={18} />
                {copy.replay}
              </button>
              <button className="btn ghost" type="button" onClick={onExit}>
                <ArrowLeft size={18} />
                {copy.levelSelect}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
