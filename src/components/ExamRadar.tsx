// 考点雷达（唯一责任人：4号）
// 展示疑似考点：时间、命中词、原句；点击定位原文。
import type { ExamHit, Segment } from "../../shared/types";
import { formatMs } from "./TopBar";

/** 已解析的考点条目（1号负责将 ExamHit 关联到片段内容） */
export interface ResolvedExamHit extends ExamHit {
  startMs: number;
  text: string;
}

export interface ExamRadarProps {
  /** 疑似考点列表（由 App 对现有片段重算 detectExamHits 得到） */
  hits: ResolvedExamHit[];
  /** 点击卡片定位原文：传片段 id，App 设置高亮并滚动 */
  onLocate: (segmentId: Segment["id"]) => void;
}

export function ExamRadar(props: ExamRadarProps) {
  return (
    <section className="panel exam-radar">
      <h2>考点雷达（疑似考点 {props.hits.length} 处）</h2>
      {props.hits.length === 0 ? (
        <p className="empty">暂未发现疑似考点。</p>
      ) : (
        <ul className="exam-list">
          {props.hits.map((hit) => (
            <li key={hit.segmentId}>
              <button
                className="exam-item"
                onClick={() => props.onLocate(hit.segmentId)}
                title="点击定位原文"
              >
                <span className="exam-time">[{formatMs(hit.startMs)}]</span>
                <span className="exam-keyword">★ {hit.keyword}</span>
                <span className="exam-text">{hit.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
