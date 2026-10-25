// 急救面板（唯一责任人：4号）
// 红色主按钮 + 最近2分钟回溯结果展示。按钮操作通过回调交给 App.tsx。
import type { RescueResult } from "../../shared/types";
import { formatMs } from "./TopBar";

export interface RescuePanelProps {
  /** 是否可点击（recording/stopped 且有文本；无文本时禁用） */
  canRescue: boolean;
  /** 独立加载状态：请求中禁止重复点击 */
  loading: boolean;
  /** 最近一次回溯结果（null 表示尚未请求） */
  result: RescueResult | null;
  /** "ai" | "extract"，extract 时必须明确显示“原文整理” */
  resultMode: "ai" | "extract" | null;
  /** 错误提示（可重试） */
  error: string | null;
  /** 本次实际回溯窗口（毫秒），用于展示时间范围 */
  windowRange: { fromMs: number; toMs: number } | null;
  onRescue: () => void;
  onRetry: () => void;
}

export function RescuePanel(props: RescuePanelProps) {
  return (
    <section className="panel rescue-panel">
      <h2>走神急救</h2>
      <button
        className="rescue-button"
        onClick={props.onRescue}
        disabled={!props.canRescue || props.loading}
      >
        {props.loading ? "正在回溯…" : "我走神了！"}
      </button>
      <p className="rescue-hint">回溯点击时最近 2 分钟的课堂内容</p>
      {props.error && (
        <div className="rescue-error">
          <p>{props.error}</p>
          <button onClick={props.onRetry}>重试</button>
        </div>
      )}
      {props.result && (
        <div className="rescue-result">
          {props.resultMode === "extract" && (
            <p className="badge badge-extract">原文整理（未使用 AI）</p>
          )}
          {props.windowRange && (
            <p className="rescue-window">
              回溯范围：{formatMs(props.windowRange.fromMs)} ~{" "}
              {formatMs(props.windowRange.toMs)}
            </p>
          )}
          <h3>刚才错过的内容</h3>
          <p>{props.result.missed}</p>
          <h3>当前主题</h3>
          <p>{props.result.topic}</p>
          <h3>最新进度</h3>
          <p>{props.result.latest}</p>
        </div>
      )}
    </section>
  );
}
