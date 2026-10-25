// 顶部控制区（唯一责任人：4号；设计移植自 ljx 分支，props 由 1号固定）
import type { InputMode, SpeechStatus } from "../../shared/types";
import { Icon } from "./Icon";

export interface TopBarProps {
  mode: InputMode;
  status: SpeechStatus;
  elapsedMs: number;
  canStart: boolean;
  canStop: boolean;
  /** 首次尚未开始时允许选择模式；已有课堂切换走新建课堂流程 */
  canSelectMode: boolean;
  onSelectMode: (mode: InputMode) => void;
  onStart: () => void;
  onStop: () => void;
  onNewSession: () => void;
}

export function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

const STATUS_TEXT: Record<SpeechStatus, string> = {
  idle: "准备就绪",
  starting: "正在连接",
  recording: "听课中",
  stopping: "正在停止",
  stopped: "课堂已结束",
  error: "连接出错",
};

export function TopBar(p: TopBarProps) {
  return (
    <>
      <header className="brandbar">
        <span className="brand">
          <span className="brand-icon">
            <Icon name="pulse" size={24} />
          </span>
          走神急救
          <span className="brand-divider" />
          <span className="brand-tagline">一键接上你错过的课堂</span>
        </span>
        {p.mode === "demo" && (
          <span className="demo-badge">
            <span />
            演示模式
          </span>
        )}
      </header>
      <section className="coursebar" aria-label="课堂控制">
        <div className="course-identity">
          <span className="course-icon">
            <Icon name="book" size={22} />
          </span>
          <div>
            <span className="eyebrow">走神急救按钮 · 课堂回溯</span>
            <h1>顺序栈与课堂重点</h1>
          </div>
        </div>
        <div className="classroom-controls">
          <span className={`status status-${p.status}`}>
            <span className="status-dot" />
            {STATUS_TEXT[p.status]}
          </span>
          <span className="elapsed" title="课堂计时，停止后冻结">
            <Icon name="clock" size={16} />
            <span>{formatMs(p.elapsedMs)}</span>
          </span>
          <span className="control-divider" />
          <label className="mode-option">
            <input
              type="radio"
              name="mode"
              checked={p.mode === "live"}
              disabled={!p.canSelectMode}
              onChange={() => p.onSelectMode("live")}
            />
            实时
          </label>
          <label className="mode-option">
            <input
              type="radio"
              name="mode"
              checked={p.mode === "demo"}
              disabled={!p.canSelectMode}
              onChange={() => p.onSelectMode("demo")}
            />
            演示
          </label>
          {p.status !== "recording" && p.status !== "stopping" && (
            <button className="button dark" disabled={!p.canStart} onClick={p.onStart}>
              <Icon name="play" size={16} />
              开始听课
            </button>
          )}
          {(p.status === "recording" || p.status === "stopping") && (
            <button className="button quiet" disabled={!p.canStop} onClick={p.onStop}>
              <Icon name="stop" size={15} />
              {p.status === "stopping" ? "正在停止…" : "结束课堂"}
            </button>
          )}
          <button className="button quiet" onClick={p.onNewSession}>
            <Icon name="plus" size={16} />
            新建课堂
          </button>
        </div>
      </section>
    </>
  );
}
