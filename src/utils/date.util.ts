/** UTC Date → KST Date (getUTC* 메서드로 KST 시간 추출용) */
export function toKST(date: Date): Date {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}
