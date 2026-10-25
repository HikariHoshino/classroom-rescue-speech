// 急救面板（唯一责任人：4号；设计移植自 ljx 分支，props 由 1号固定）
// 红色主按钮回溯最近 2 分钟；三项结果、时间范围、错误与重试。
import type { RescueResult } from "../../shared/types";
import { formatMs } from "./TopBar";
import { Icon } from "./Icon";

export interface RescuePanelProps {
  canRescue: boolean;
  loading: boolean;
  result: RescueResult | null;
  resultMode: "ai" | "extract" | null;
  error: string | null;
  windowRange: { fromMs: number; toMs: number } | null;
  onRescue: () => void;
  onRetry: () => void;
}

export function RescuePanel(props: RescuePanelProps) {
  return (
    <section className="panel rescue-panel">
      <div className="panel-heading">
        <div className="heading-label">
          <Icon name="rewind" />
          <h2>走神急救</h2>
        </div>
      </div>
      <div className="physical-rescue">
        <p className="rescue-prompt">刚才没听进去？</p>
        <div
          className={`rescue-base ${props.canRescue ? "available" : "unavailable"}`}
        >
          <button
            className="rescue-button"
            disabled={!props.canRescue || props.loading}
            aria-label="我刚走神了"
            onClick={props.onRescue}
          >
            <span>{props.loading ? "正在" : "我刚"}</span>
            <span>{props.loading ? "回溯…" : "走神了"}</span>
          </button>
        </div>
        <p className="rescue-helper">
          {props.canRescue
            ? "按一下，回溯最近 2 分钟的课堂内容"
            : "开始听课后即可回溯"}
        </p>
      </div>

      {props.loading && (
        <div className="request-loading" role="status">
          <span className="spinner" />
          <h3>正在帮你接上课堂……</h3>
          <p>只整理点击那一刻的快照，课堂仍在继续。</p>
        </div>
      )}

      {props.error && !props.loading && (
        <div className="request-error" role="alert">
          <Icon name="info" size={23} />
          <h3>这次没能整理好</h3>
          <p>{props.error}</p>
          <button className="button red" onClick={props.onRetry}>
            重试本次回溯
          </button>
        </div>
      )}

      {props.result && !props.loading && (
        <div className="rescue-result">
          <div className="result-meta">
            {props.resultMode === "extract" && (
              <span className="example-badge">原文整理（未使用 AI）</span>
            )}
            {props.windowRange && (
              <span>
                回溯范围 {formatMs(props.windowRange.fromMs)} —{" "}
                {formatMs(props.windowRange.toMs)}
              </span>
            )}
          </div>
          <section className="result-block">
            <span className="result-number">01</span>
            <div>
              <h3>你刚错过了什么</h3>
              <p>{props.result.missed}</p>
            </div>
          </section>
          <section className="result-block core-block">
            <span className="result-number">02</span>
            <div>
              <h3>当前主题</h3>
              <p>{props.result.topic}</p>
            </div>
          </section>
          <section className="result-block">
            <span className="result-number">03</span>
            <div>
              <h3>截至点击时，老师讲到哪里</h3>
              <p>{props.result.latest}</p>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
