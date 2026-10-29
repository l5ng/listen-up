import { useState } from 'react';
import { Check, ChevronLeft, Info, Map, Play, Settings } from 'lucide-react';
import { levels } from '@listen-up/sim';
import { copy } from './copy';
import type { AppSettings } from './app/settings';
import { hasModel, loadProgress, loadSettings, saveProgress, saveSettings } from './app/settings';
import { SettingsModal } from './ui/SettingsModal';
import { CreditsModal } from './ui/CreditsModal';
import { GameScreen } from './ui/GameScreen';

type Screen = 'title' | 'levels' | 'game';

export function App() {
  const [screen, setScreen] = useState<Screen>('title');
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [progress, setProgress] = useState(() => loadProgress());
  const [selectedId, setSelectedId] = useState<string>(levels[0]?.id ?? '');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [runId, setRunId] = useState(0);

  const selected = levels.find((level) => level.id === selectedId) ?? levels[0];
  const modelReady = hasModel(settings);

  const startLevel = (id: string) => {
    if (!modelReady) {
      setSettingsOpen(true);
      return;
    }
    setSelectedId(id);
    setRunId((value) => value + 1);
    setScreen('game');
  };

  const completeLevel = (levelId: string) => {
    setProgress((current) => {
      if (current.completed.includes(levelId)) return current;
      const next = { completed: [...current.completed, levelId], lastLevel: levelId };
      saveProgress(next);
      return next;
    });
  };

  const nextLevel = () => {
    if (!selected) return;
    const index = levels.findIndex((level) => level.id === selected.id);
    const next = levels[index + 1];
    if (next) {
      setSelectedId(next.id);
      setRunId((value) => value + 1);
    } else {
      setScreen('levels');
    }
  };

  return (
    <>
      {screen === 'title' ? (
        <div className="screen title-screen">
          <main className="title-card">
            <h1 className="game-title">{copy.title}</h1>
            <p className="game-subtitle">{copy.subtitle}</p>
            <div className="title-actions">
              <button
                className="btn primary"
                onClick={() => {
                  if (modelReady) setScreen('levels');
                  else setSettingsOpen(true);
                }}
                type="button"
              >
                <Play size={20} />
                {copy.start}
              </button>
              <button className="btn leaf" onClick={() => setScreen('levels')} type="button">
                <Map size={20} />
                {copy.levels}
              </button>
              <button className="btn ghost" onClick={() => setSettingsOpen(true)} type="button">
                <Settings size={20} />
                {copy.settings}
              </button>
              <button className="btn ghost" onClick={() => setCreditsOpen(true)} type="button">
                <Info size={20} />
                {copy.credits}
              </button>
            </div>
            <p className="muted" style={{ margin: '22px 0 0', fontSize: 14 }}>
              {modelReady
                ? `模型：${settings.provider.model}`
                : '还没有连接模型。先设置一个 OpenAI 兼容接口。'}
            </p>
          </main>
        </div>
      ) : null}

      {screen === 'levels' ? (
        <div className="screen">
          <div className="screen-inner">
            <header className="page-head">
              <div>
                <h1 className="page-title">天空浮岛</h1>
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  每一关都让 A 和 B 必须互相配合才能到达旗门。
                </p>
              </div>
              <div className="row">
                <button className="btn ghost" onClick={() => setScreen('title')} type="button">
                  <ChevronLeft size={18} />
                  {copy.back}
                </button>
                <button
                  className="btn icon-only ghost"
                  onClick={() => setSettingsOpen(true)}
                  type="button"
                  aria-label={copy.settings}
                >
                  <Settings size={20} />
                </button>
              </div>
            </header>

            {!modelReady ? (
              <div className="test-result error" style={{ marginBottom: 18 }}>
                {copy.providerHint}
                <button
                  className="btn small leaf"
                  style={{ marginLeft: 10 }}
                  onClick={() => setSettingsOpen(true)}
                  type="button"
                >
                  {copy.providerMissing}
                </button>
              </div>
            ) : null}

            <div className="level-grid">
              {levels.map((level, index) => {
                const done = progress.completed.includes(level.id);
                return (
                  <article className="level-card" key={level.id}>
                    {done ? (
                      <span className="level-done">
                        <Check size={14} />
                        已完成
                      </span>
                    ) : null}
                    <span className="level-index">{index + 1}</span>
                    <h2 className="level-name">{level.name}</h2>
                    <p className="level-summary">{level.summary}</p>
                    <p className="level-summary" style={{ fontSize: 14 }}>
                      {level.hints[0]}
                    </p>
                    <button
                      className="btn primary"
                      onClick={() => startLevel(level.id)}
                      type="button"
                    >
                      <Play size={18} />
                      {modelReady ? '进入关卡' : copy.providerMissing}
                    </button>
                  </article>
                );
              })}
            </div>

            <p className="muted" style={{ marginTop: 22, fontSize: 14, lineHeight: 1.6 }}>
              B
              会自己找路、等待、推箱和操作机关。你的任务是用自然语言说清目标、条件、规则和协作意图。
            </p>
          </div>
        </div>
      ) : null}

      {screen === 'game' && selected ? (
        <GameScreen
          key={`${selected.id}-${runId}`}
          level={selected}
          settings={settings}
          onExit={() => setScreen('levels')}
          onOpenSettings={() => setSettingsOpen(true)}
          onComplete={completeLevel}
          onNext={nextLevel}
          reduceMotion={settings.reduceMotion}
        />
      ) : null}

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        inGame={screen === 'game'}
        onClose={() => setSettingsOpen(false)}
        onSave={(next) => {
          setSettings(next);
          saveSettings(next);
          setSettingsOpen(false);
        }}
      />
      <CreditsModal open={creditsOpen} onClose={() => setCreditsOpen(false)} />
    </>
  );
}
