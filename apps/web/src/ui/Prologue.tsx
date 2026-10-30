import { Preload, useProgress } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { LoaderCircle, Send, Sparkles, X } from 'lucide-react';
import type { LlmClient, LlmDelta, LlmRequest } from '@listen-up/agent';
import { GameSession } from '@listen-up/game';
import { getLevel } from '@listen-up/sim';
import { copy } from '../copy';
import { CharacterView } from '../game/CharacterView';
import { LevelView } from '../game/LevelView';
import { PropsLayer } from '../game/PropsLayer';
import { SkyAndClouds } from '../game/SkyAndClouds';

const demoLevel = getLevel('sky-01');
const suggestions = ['把木箱推下来', '推箱子给我垫脚', '把箱子推下去'];

class DemoBrain implements LlmClient {
  private step = 0;
  private toolId = 0;

  async *stream(request: LlmRequest): AsyncIterable<LlmDelta> {
    const lastUser = request.messages.toReversed().find((message) => message.role === 'user');
    const said = typeof lastUser?.content === 'string' ? lastUser.content : '';
    if (this.step === 0) {
      if (!/推|箱/.test(said)) {
        yield { type: 'content', text: copy.prologueFallback };
        yield { type: 'finish', reason: 'stop' };
        return;
      }
      yield { type: 'content', text: '好，推下去。' };
      this.toolId += 1;
      yield {
        type: 'tool_call',
        index: 0,
        id: 'demo_push_' + String(this.toolId),
        name: 'push_box',
        argumentsDelta: JSON.stringify({ box: 'crate_1', direction: '南' }),
      };
      yield { type: 'finish', reason: 'tool_calls' };
      this.step = 1;
      return;
    }
    yield { type: 'content', text: '推下去了。' };
    yield { type: 'finish', reason: 'stop' };
    this.step = 0;
  }
}

function createDemoSession(): GameSession {
  return new GameSession({
    level: demoLevel,
    client: new DemoBrain(),
    model: 'demo',
    maxSteps: 8,
  });
}

function DemoTicker({ session }: { session: GameSession }) {
  useFrame((_, delta) => session.tick(delta));
  return null;
}

function DemoCamera() {
  const { camera } = useThree();
  useLayoutEffect(() => {
    camera.position.set(13, 8, 15.5);
    camera.lookAt(5.5, 1.7, 8);
  }, [camera]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    camera.position.set(13 + Math.sin(t * 0.12) * 0.6, 8, 15.5 + Math.cos(t * 0.12) * 0.6);
    camera.lookAt(5.5, 1.7, 8);
  });
  return null;
}

interface PrologueProps {
  modelReady: boolean;
  onClose: () => void;
  onConnect: () => void;
}

export function Prologue({ modelReady, onClose, onConnect }: PrologueProps) {
  const [session, setSession] = useState(createDemoSession);
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { active: loading, progress } = useProgress();
  const ui = useSyncExternalStore(session.subscribe, session.getUiSnapshot);

  useEffect(() => {
    return () => {
      session.dispose();
    };
  }, [session]);

  const done = submitted && !ui.turnActive && ui.speech.includes('推下去了');
  const failed = submitted && !ui.turnActive && ui.speech.includes('只听得懂');

  const send = (value?: string) => {
    const clean = (value ?? text).trim();
    if (!clean || ui.turnActive) return;
    setText('');
    setSubmitted(true);
    session.say(clean);
  };

  const retry = () => {
    session.dispose();
    setSession(createDemoSession());
    setText('');
    setSubmitted(false);
  };

  return (
    <div className="prologue-screen" role="dialog" aria-modal="true" aria-label="Listen Up 演示">
      <div className="prologue-canvas">
        <Canvas
          shadows={{ type: THREE.PCFShadowMap }}
          dpr={[1, 1.75]}
          camera={{ fov: 45, near: 0.1, far: 220 }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.NoToneMapping;
            gl.outputColorSpace = THREE.SRGBColorSpace;
          }}
        >
          <Suspense fallback={null}>
            <SkyAndClouds />
            <LevelView level={demoLevel} />
            <PropsLayer session={session} />
            <CharacterView session={session} which="a" />
            <CharacterView session={session} which="b" />
            <Preload all />
          </Suspense>
          <DemoTicker session={session} />
          <DemoCamera />
        </Canvas>
      </div>

      <div className="prologue-top">
        <span className="demo-badge">{copy.prologueBadge}</span>
        <button className="btn small ghost" type="button" onClick={onConnect}>
          {modelReady ? copy.prologueSkipShort : copy.prologueSkip}
        </button>
        <button
          className="btn icon-only ghost"
          type="button"
          onClick={onClose}
          aria-label={copy.back}
        >
          <X size={19} />
        </button>
      </div>

      <div className="prologue-card">
        {done ? (
          <div className="prologue-done">
            <div className="prologue-done-head">
              <span className="prologue-spark">
                <Sparkles size={18} />
              </span>
              <h2>{copy.prologueDoneTitle}</h2>
            </div>
            <p className="muted">{copy.prologueDoneLead}</p>
            <div className="prologue-actions">
              <button className="btn primary" type="button" onClick={onConnect}>
                {modelReady ? copy.titlePlay : copy.prologueConnect}
              </button>
              <button className="btn ghost" type="button" onClick={retry}>
                {copy.prologueRetry}
              </button>
            </div>
          </div>
        ) : submitted && !failed ? (
          <div className="prologue-busy" role="status">
            <LoaderCircle className="spin" size={22} />
            <span>{copy.prologueBusy}</span>
          </div>
        ) : (
          <>
            <p className="prologue-step">{copy.prologueStep}</p>
            <h2>{copy.prologueTitle}</h2>
            <p className="muted">{failed ? copy.prologueFallback : copy.prologueLead}</p>
            <div className="prologue-suggestions">
              {suggestions.map((item) => (
                <button
                  className="suggestion-chip"
                  type="button"
                  key={item}
                  onClick={() => send(item)}
                  disabled={ui.turnActive}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="input-shell prologue-input-shell">
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value.slice(0, 200))}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder={copy.prologueInput}
                aria-label={copy.prologueInput}
                spellCheck={false}
                autoFocus
              />
              <button
                className="send-btn"
                type="button"
                onClick={() => send()}
                disabled={!text.trim() || ui.turnActive}
                aria-label={copy.send}
              >
                <Send size={20} />
              </button>
            </div>
          </>
        )}
      </div>

      {loading ? (
        <div className="prologue-loading" role="status">
          <LoaderCircle className="spin" size={24} />
          <span>正在搭场景 {Math.round(progress)}%</span>
        </div>
      ) : null}
    </div>
  );
}
