// 演示回放时间轴（可由 server/asr/tools/transcribe-file.ts --write 重新生成，也可手工微调）。
// 来源：占位样例——Windows 中文 TTS 合成的“栈”讲稿，按每句合成时长精确计时。
// 5 号交付真实录音后，用 transcribe-file.ts 对真实录音重新生成本文件。
import type { Segment } from "../../shared/types";

/** public/ 下的演示音频地址 */
export const demoAudioUrl = "/demo/lecture.wav";

export const demoSegments: Segment[] = [
  { id: "demo-01", startMs: 600, endMs: 7080, text: "同学们好，今天我们来学习一种新的数据结构，叫做栈。" },
  { id: "demo-02", startMs: 7680, endMs: 17855, text: "栈是一种只允许在一端进行插入和删除操作的线性表，这一端叫做栈顶，另一端叫做栈底。" },
  { id: "demo-03", startMs: 18455, endMs: 26905, text: "栈最重要的特点是先进后出，也就是最先放进去的元素，最后才能取出来。" },
  { id: "demo-04", startMs: 27505, endMs: 35810, text: "大家可以想象一摞盘子，我们总是从最上面放盘子，也从最上面拿盘子。" },
  { id: "demo-05", startMs: 36410, endMs: 44480, text: "往栈里放入元素的操作叫做入栈，也叫压栈，新元素会成为新的栈顶。" },
  { id: "demo-06", startMs: 45080, endMs: 52285, text: "从栈里取出元素的操作叫做出栈，取出的总是当前的栈顶元素。" },
  { id: "demo-07", startMs: 52885, endMs: 62630, text: "接下来看顺序栈，顺序栈是用一个数组来存放栈里的元素，再用一个变量记录栈顶的位置。" },
  { id: "demo-08", startMs: 63230, endMs: 74190, text: "注意，顺序栈的容量是固定的，当栈顶指针等于最大容量减一的时候，栈就满了，这时候不能再入栈。" },
  { id: "demo-09", startMs: 74790, endMs: 81195, text: "同样的，栈为空的时候也不能出栈，否则就会发生下溢。" },
  { id: "demo-10", startMs: 81795, endMs: 88175, text: "这个知识点期末会考，判满和判空的条件大家一定要记住。" },
  { id: "demo-11", startMs: 88775, endMs: 96375, text: "好，栈的基本操作就讲到这里，下面我们进入下一个知识点，队列。" },
  { id: "demo-12", startMs: 96975, endMs: 103395, text: "队列和栈不同，它是先进先出的，就像排队买饭一样。" },
];
