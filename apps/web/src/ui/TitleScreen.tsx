import {
  ArrowRight,
  Info,
  KeyRound,
  Map,
  MessageCircle,
  Play,
  Route,
  Settings,
  Users,
} from 'lucide-react';
import { copy } from '../copy';
import heroArt from '../assets/hero.jpg';

interface TitleScreenProps {
  modelReady: boolean;
  modelName?: string;
  onStart: () => void;
  onTryDemo: () => void;
  onLevels: () => void;
  onSettings: () => void;
  onCredits: () => void;
}

const points = [
  { icon: MessageCircle, text: copy.pointTalk },
  { icon: Route, text: copy.pointMove },
  { icon: Users, text: copy.pointTogether },
];

export function TitleScreen({
  modelReady,
  modelName,
  onStart,
  onTryDemo,
  onLevels,
  onSettings,
  onCredits,
}: TitleScreenProps) {
  return (
    <div className="title-screen">
      <img className="title-art" src={heroArt} alt="" aria-hidden="true" />

      <nav className="title-topbar" aria-label="首页导航">
        <button
          className="btn small ghost"
          type="button"
          onClick={onLevels}
          aria-label={copy.levels}
        >
          <Map size={16} />
          <span>{copy.levels}</span>
        </button>
        <button
          className="btn small ghost"
          type="button"
          onClick={onSettings}
          aria-label={copy.settings}
        >
          <Settings size={16} />
          <span>{copy.settings}</span>
        </button>
        <button
          className="btn small ghost"
          type="button"
          onClick={onCredits}
          aria-label={copy.credits}
        >
          <Info size={16} />
          <span>{copy.credits}</span>
        </button>
      </nav>

      <main className="title-card">
        <p className="title-kicker">3D 双人解谜 · 你 + AI 搭子</p>
        <h1 className="game-title">{copy.title}</h1>
        <p className="title-tagline">{copy.tagline}</p>
        <p className="title-lead">{copy.titleLead}</p>

        <ul className="title-points">
          {points.map(({ icon: Icon, text }) => (
            <li key={text} className="title-point">
              <span className="title-point-icon">
                <Icon size={15} />
              </span>
              {text}
            </li>
          ))}
        </ul>

        <p className="title-meta">{copy.titleMeta}</p>

        <div className="title-actions">
          <button className="btn primary title-main-btn" type="button" onClick={onStart}>
            {modelReady ? <Play size={19} /> : <MessageCircle size={19} />}
            {modelReady ? copy.titlePlay : copy.titleTry}
            <ArrowRight size={18} />
          </button>
          {modelReady ? (
            <button className="btn leaf" type="button" onClick={onTryDemo}>
              <Play size={17} />
              {copy.titleDemo}
            </button>
          ) : (
            <button className="btn leaf" type="button" onClick={onSettings}>
              <KeyRound size={17} />
              {copy.titleConnect}
            </button>
          )}
        </div>

        <p className="title-trust">
          {modelReady && modelName ? (
            <span className="title-model">已连接：{modelName}</span>
          ) : null}
          {modelReady && modelName ? ' · ' : null}
          {copy.titleTrust}
        </p>
      </main>
    </div>
  );
}
