export const SearchHighlight = ({ text, query }: { text: string; query: string }) => {
  const keyword = query.trim().toLocaleLowerCase("zh-CN");
  if (!keyword) return <>{text}</>;
  const parts = [];
  const lower = text.toLocaleLowerCase("zh-CN");
  let cursor = 0;
  let match = lower.indexOf(keyword);
  while (match >= 0) {
    parts.push(text.slice(cursor, match), <mark key={match}>{text.slice(match, match + query.trim().length)}</mark>);
    cursor = match + query.trim().length;
    match = lower.indexOf(keyword, cursor);
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
};
