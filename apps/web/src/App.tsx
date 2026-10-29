import { useState } from 'react';
import { Check, ChevronLeft, Play, Settings } from 'lucide-react';
import { COMPANION_NAME, levels, PLAYER_NAME } from '@listen-up/sim';
import { copy } from './copy';
import type { AppSettings } from './app/settings';
import { hasModel, loadProgress, loadSettings, saveProgress, saveSettings } from './app/settings';
import { SettingsModal } from './ui/SettingsModal';
import { CreditsModal } from './ui/CreditsModal';
import { GameScreen } from './ui/GameScreen';
import { Prologue } from './ui/Prologue';
import { TitleScreen } from './ui/TitleScreen';

type Screen = 'title' | 'levels' | 'game';

export function App() {
  const [screen, setScreen] = useState<Screen>('title');
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [progress, setProgress] = useState(() => loadProgress());
  const [selectedId, setSelectedId] = useState<string>(levels[0]?.id ?? '');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [prologueOpen, setPrologueOpen] = useState(false);
  const [startAfterSave, setStartAfterSave] = useState(false);
  const [runId, setRunId] = useState(0);

  const selected = levels.find((level) => level.id === selectedId) ?? levels[0];
  const modelReady = hasModel(settings);

  const openSettings = (mode: 'settings' | 'connect') => {
    setStartAfterSave(mode === 'connect');
    setSettingsOpen(true);
  };

  const startLevel = (id: string) => {
    if (!modelReady) {
      openSettings('connect');
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
      <div className="app-layer" inert={prologueOpen || settingsOpen || creditsOpen}>
        {screen === 'title' ? (
          <TitleScreen
            modelReady={modelReady}
            modelName={settings.provider.model}
            onStart={() => {
              if (modelReady) setScreen('levels');
              else setPrologueOpen(true);
            }}
            onTryDemo={() => setPrologueOpen(true)}
            onLevels={() => setScreen('levels')}
            onSettings={() => openSettings(modelReady ? 'settings' : 'connect')}
            onCredits={() => setCreditsOpen(true)}
          />
        ) : null}

        {screen === 'levels' ? (
          <div className="screen">
            <div className="screen-inner">
              <header className="page-head">
                <div>
                  <h1 className="page-title">天空浮岛</h1>
                  <p className="muted" style={{ margin: '4px 0 0' }}>
                    每一关都让 {PLAYER_NAME} 和 {COMPANION_NAME} 必须互相配合才能到达旗门。
                  </p>
                </div>
                <div className="row">
                  <button className="btn ghost" onClick={() => setScreen('title')} type="button">
                    <ChevronLeft size={18} />
                    {copy.back}
                  </button>
                  <button
                    className="btn icon-only ghost"
                    onClick={() => openSettings('settings')}
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
                    onClick={() => openSettings('connect')}
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
                {COMPANION_NAME}{' '}
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
            onOpenSettings={() => openSettings('settings')}
            onComplete={completeLevel}
            onNext={nextLevel}
            reduceMotion={settings.reduceMotion}
          />
        ) : null}
      </div>

      {prologueOpen ? (
        <Prologue
          modelReady={modelReady}
          onClose={() => setPrologueOpen(false)}
          onConnect={() => {
            setPrologueOpen(false);
            if (modelReady) setScreen('levels');
            else openSettings('connect');
          }}
        />
      ) : null}

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        inGame={screen === 'game'}
        onClose={() => {
          setSettingsOpen(false);
          setStartAfterSave(false);
        }}
        onTryDemo={() => {
          setSettingsOpen(false);
          setPrologueOpen(true);
        }}
        onSave={(next) => {
          setSettings(next);
          saveSettings(next);
          setSettingsOpen(false);
          if (startAfterSave && hasModel(next)) setScreen('levels');
          setStartAfterSave(false);
        }}
      />
      <CreditsModal open={creditsOpen} onClose={() => setCreditsOpen(false)} />
    </>
  );
}
