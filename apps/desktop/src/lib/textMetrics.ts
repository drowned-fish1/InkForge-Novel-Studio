export const countCjkAwareWords = (value: string): number => {
  const cjk = value.match(/[\u4E00-\u9FFF]/g)?.length ?? 0;
  const latinWords = value.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + latinWords;
};
