/** UTC Date → KST Date (getUTC* 메서드로 KST 시간 추출용) */
export function toKST(date: Date): Date {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}

/** Date → KST HH:mm 문자열 */
export function toKSTTimeStr(date: Date): string {
  const kst = toKST(date);
  return `${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
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

/** 시작 시간에 이용 시간(분)을 더해 종료 시간 반환 */
export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}
