// 顶部控制区（唯一责任人：4号）
// props 由 1号固定，4号只完善内部实现，不改动参数签名。
import type { InputMode, SpeechStatus } from "../../shared/types";

export interface TopBarProps {
  /** 当前模式（live=实时，demo=演示回放） */
  mode: InputMode;
  /** 课堂状态机状态 */
  status: SpeechStatus;
  /** 课堂已进行时长（毫秒，停止后冻结），由 1号统一计时 */
  elapsedMs: number;
  /** 是否允许开始（idle/error 且未在连接中） */
  canStart: boolean;
  /** 是否允许停止（recording 中） */
  canStop: boolean;
  /** 首次尚未开始时允许选择模式；已有课堂时切换模式走新建课堂流程 */
  canSelectMode: boolean;
  onSelectMode: (mode: InputMode) => void;
  onStart: () => void;
  onStop: () => void;
  onNewSession: () => void;
}

const STATUS_TEXT: Record<SpeechStatus, string> = {
  idle: "尚未开始",
  starting: "正在连接",
  recording: "记录中",
  stopping: "正在停止",
  stopped: "已停止",
  error: "出错",
};

export function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function TopBar(props: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="top-bar-mode">
        <label>
          <input
            type="radio"
            name="mode"
            checked={props.mode === "live"}
            disabled={!props.canSelectMode}
            onChange={() => props.onSelectMode("live")}
          />
          实时模式
        </label>
        <label>
          <input
            type="radio"
            name="mode"
            checked={props.mode === "demo"}
            disabled={!props.canSelectMode}
            onChange={() => props.onSelectMode("demo")}
          />
          演示模式
        </label>
        {props.mode === "demo" && <span className="badge badge-demo">演示模式</span>}
      </div>
      <div className="top-bar-status">
        <span className={`status status-${props.status}`}>
          {STATUS_TEXT[props.status]}
        </span>
        <span className="timer">{formatMs(props.elapsedMs)}</span>
      </div>
      <div className="top-bar-actions">
        <button onClick={props.onStart} disabled={!props.canStart}>
          开始记录
        </button>
        <button onClick={props.onStop} disabled={!props.canStop}>
          停止
        </button>
        <button onClick={props.onNewSession}>新建课堂</button>
      </div>
    </header>
  );
}
