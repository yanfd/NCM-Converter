import { getCurrentWindow } from "@tauri-apps/api/window";

export default function WindowControls() {
  const win = getCurrentWindow();

  return (
    <div className="win-controls">
      <button className="win-btn win-btn--close" onClick={() => win.close()} title="关闭">
        <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.5"><line x1="1" y1="1" x2="7" y2="7"/><line x1="7" y1="1" x2="1" y2="7"/></svg>
      </button>
      <button className="win-btn win-btn--minimize" onClick={() => win.minimize()} title="最小化">
        <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.5"><line x1="1" y1="4" x2="7" y2="4"/></svg>
      </button>
      <button className="win-btn win-btn--maximize" onClick={() => win.toggleMaximize()} title="最大化">
        <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.2"><rect x="1" y="1" width="6" height="6" rx="0.8"/></svg>
      </button>
    </div>
  );
}
