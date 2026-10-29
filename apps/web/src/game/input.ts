export interface InputState {
  pressed: Set<string>;
  attach: () => () => void;
}

export function createInputState(): InputState {
  const pressed = new Set<string>();
  return {
    pressed,
    attach: () => {
      const down = (event: KeyboardEvent) => {
        pressed.add(event.code);
      };
      const up = (event: KeyboardEvent) => {
        pressed.delete(event.code);
      };
      const blur = () => pressed.clear();
      window.addEventListener('keydown', down);
      window.addEventListener('keyup', up);
      window.addEventListener('blur', blur);
      return () => {
        window.removeEventListener('keydown', down);
        window.removeEventListener('keyup', up);
        window.removeEventListener('blur', blur);
      };
    },
  };
}
