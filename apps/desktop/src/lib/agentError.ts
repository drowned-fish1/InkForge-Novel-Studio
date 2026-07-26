const ipcErrorPrefix = /^Error invoking remote method '[^']+': Error:\s*/i;

export const formatAgentError = (reason: unknown): string => {
  const raw = reason instanceof Error ? reason.message : String(reason || "");
  const message = raw.replace(ipcErrorPrefix, "").trim();

  if (/neither text nor tool calls|没有返回可显示的文字或工具调用/i.test(message)) {
    return "模型本次没有返回有效内容。系统已保留你的消息，请重试。";
  }
  if (/length limit|长度上限/i.test(message)) {
    return "模型输出达到长度上限，未能生成完整结果。请提高最大输出 Token，或缩小本次任务范围。";
  }
  return message || "Agent 执行失败，请重试。";
};
