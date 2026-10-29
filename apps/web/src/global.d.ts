import type { GameSession } from '@listen-up/game';
import type { Camera } from 'three';

declare global {
  interface Window {
    listenupCamera?: Camera;
    listenupSession?: GameSession;
  }
}

export {};
