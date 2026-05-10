/** UTC Date → KST Date (getUTC* 메서드로 KST 시간 추출용) */
export function toKST(date: Date): Date {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}

/** UTC Date → KST 한국어 문자열 (Claude tool result용) */
export function toKSTString(date: Date): string {
  return date.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
