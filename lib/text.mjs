// 공용 텍스트 유틸 — 스크립트(Node, .mjs)와 웹 페이지 양쪽에서 씀.
// 웹 페이지 쪽에서는 lib/text.ts가 이 파일과 동일한 로직을 갖고 있음 (Next.js가 .mjs를
// 서버 컴포넌트에서 바로 import하지 못하는 경우가 있어 TS 버전을 별도로 둠).

/** RSS description에 섞여 오는 HTML 태그/엔티티를 제거하고 앞부분만 자름 */
export function stripHtml(input, maxLen = 160) {
  if (!input) return "";
  const text = input
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trim() + "…";
}

/** 기사 고유 id — guid가 있으면 그걸, 없으면 link를 씀 */
export function itemId(item) {
  return item.guid || item.link || item.id;
}
