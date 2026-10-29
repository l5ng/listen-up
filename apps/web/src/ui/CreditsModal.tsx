import { X } from 'lucide-react';
import { copy } from '../copy';

interface CreditsModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreditsModal({ open, onClose }: CreditsModalProps) {
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="credits-title">
        <div className="row spread">
          <h2 id="credits-title">{copy.creditsTitle}</h2>
          <button className="btn icon-only ghost" onClick={onClose} aria-label={copy.close}>
            <X size={20} />
          </button>
        </div>
        <p style={{ lineHeight: 1.65 }}>
          <a href="https://kenney.nl/assets/platformer-kit" target="_blank" rel="noreferrer">
            Kenney Platformer Kit 4.1
          </a>
          ，CC0。角色、草方块、木箱、拉杆、树木等 3D 模型来自这个包，仓库里保留了原始 License.txt。
        </p>
        <p style={{ lineHeight: 1.65 }}>
          渲染使用 three.js 与 React Three Fiber；界面图标来自 Lucide；标题使用 Baloo
          2（OFL）。完整许可见仓库根目录的 CREDITS.md。
        </p>
        <p className="muted">这是一个非商业的个人项目。</p>
        <div className="modal-actions">
          <button className="btn primary" onClick={onClose} type="button">
            {copy.close}
          </button>
        </div>
      </div>
    </div>
  );
}
