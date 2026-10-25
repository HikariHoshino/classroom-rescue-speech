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

/** 明显否定表述：命中词附近出现则不自动标星 */
export const EXAM_NEGATIONS = ["不会考", "不考", "不是重点", "无需注意"] as const;

/**
 * 否定判定的作用范围：命中词前后各 6 个字符。
 * 不用「整段包含否定词就跳过」，否则「这道题不考，但栈的判满是重点」会整段丢标星。
 * 该窗口与 server/ai/engine/keywords.py 保持一致，改动时三处同步。
 */
const NEGATION_WINDOW = 6;

/**
 * 找出片段里第一个未被否定的命中词。
 * 词表顺序即优先级：同一片段命中多个词时只取最靠前的一个，避免重复卡片。
 */
function findHit(text: string): string | null {
  for (const keyword of EXAM_KEYWORDS) {
    let index = text.indexOf(keyword);
    while (index !== -1) {
      const left = Math.max(0, index - NEGATION_WINDOW);
      const right = Math.min(text.length, index + keyword.length + NEGATION_WINDOW);
      const around = text.slice(left, right);
      if (!EXAM_NEGATIONS.some((neg) => around.includes(neg))) return keyword;
      index = text.indexOf(keyword, index + 1);
    }
  }
  return null;
}

/**
 * 检测疑似考点。每个片段只生成一条提醒。
 * 结果只表示“疑似考点”，不能解释为确定考点。
 */
export function detectExamHits(items: Segment[]): ExamHit[] {
  const hits: ExamHit[] = [];
  for (const segment of items) {
    const keyword = findHit(segment.text);
    if (keyword) hits.push({ segmentId: segment.id, keyword });
  }
  return hits;
}
