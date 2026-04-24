export interface ClassInfo {
  admissionYear: number;
  section: string;
  graduated?: boolean;
}

/**
 * 반 표시 레이블 생성
 * - 재학 중: "3학년 A반"
 * - 졸업:    "졸업 A반"
 */
export function formatClassLabel(cls: ClassInfo): string {
  if (cls.graduated) {
    return `졸업 ${cls.section}반 (입학 ${cls.admissionYear})`;
  }
  const grade = new Date().getFullYear() - cls.admissionYear + 1;
  return `${grade}학년 ${cls.section}반`;
}
