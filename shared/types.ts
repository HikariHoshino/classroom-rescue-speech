// ============================================================
// 公共类型与函数契约（唯一责任人：1号）
// 来源：《走神急救按钮_开发对齐说明》第五节，字段名/单位/枚举值不得改动。
// 时间统一使用 startMs / endMs（从本节课开始计算的毫秒数）。
// 禁止使用秒单位、旧方案字段或 /api/recap。
// ============================================================

export type InputMode = "live" | "demo";

export type SpeechStatus =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "stopped"
  | "error";

export interface Segment {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface SpeechEvent {
  sessionId: string;
  status: SpeechStatus;
  message?: string;
}

export interface RescueRequest {
  sessionId: string;
  capturedAtMs: number;
  fromMs: number;
  toMs: number;
  segments: Segment[];
  contextSegments: Segment[];
}

export interface RescueResult {
  missed: string;
  topic: string;
  latest: string;
  evidenceIds: string[];
}

export interface RescueResponse {
  sessionId: string;
  resultMode: "ai" | "extract";
  data: RescueResult;
}

export interface NotesResponse {
  sessionId: string;
  resultMode: "ai" | "extract";
  markdown: string;
}

export interface ExamHit {
  segmentId: string;
  keyword: string;
}

/**
 * 笔记分节（3号 /api/notes/sections 的返回单元）。
 * examStars 只表示该知识点在历年 408 真题里出现的频次，不代表今年一定考。
 */
export interface NoteSection {
  id: string;
  title: string;
  points: string[];
  startMs: number;
  segmentIds: string[];
  examStars: 0 | 1 | 2 | 3;
  examBasis: string;
}

export interface NoteSectionsResponse {
  sessionId: string;
  resultMode: "ai" | "extract";
  sections: NoteSection[];
}

export interface ApiError {
  error: { code: string; message: string };
}
