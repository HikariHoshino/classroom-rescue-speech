// 考点雷达关键词检测（唯一责任人：3号）
// 纯函数：不发起网络请求，不读取环境变量。
import type { ExamHit, Segment } from "../../shared/types";

/** 首版词表（文档第七节约定，顺序即命中优先级） */
export const EXAM_KEYWORDS = [
  "这个要考",
  "期末",
  "考试",
  "注意",
  "重点",
  "必考",
] as const;

/** 明显否定表述：包含则不自动标星 */
export const EXAM_NEGATIONS = ["不会考", "不考", "不是重点", "无需注意"] as const;

/**
 * 检测疑似考点。每个片段只生成一条提醒，取词表中第一个命中项。
 * 结果只表示“疑似考点”，不能解释为确定考点。
 */
export function detectExamHits(items: Segment[]): ExamHit[] {
  const hits: ExamHit[] = [];
  for (const seg of items) {
    if (EXAM_NEGATIONS.some((neg) => seg.text.includes(neg))) continue;
    const keyword = EXAM_KEYWORDS.find((kw) => seg.text.includes(kw));
    if (keyword) hits.push({ segmentId: seg.id, keyword });
  }
  return hits;
}
