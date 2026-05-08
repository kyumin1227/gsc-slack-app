import { ScheduleStatus } from '../schedule.entity';
import { TagStatus } from '../../tag/tag.entity';

// 시간표 목록 항목
export interface ScheduleListItem {
  id: number;
  name: string;
  description?: string;
  status: ScheduleStatus;
  tags: { id: number; name: string }[];
  createdBy: { name: string };
  channels: string[];
  writers: string[];
  createdAt: Date;
}

// 시간표 수정 모달 입력 항목
export interface EditScheduleItem {
  id: number;
  name: string;
  description?: string;
  tags: { id: number; name: string }[];
}

// 구독 검색 결과 항목
export interface SubscribeScheduleItem {
  id: number;
  name: string;
  description?: string;
  calendarId: string;
  tags: { id: number; name: string }[];
  channels: string[];
  writers: string[];
  isSubscribed: boolean;
}

// 태그 선택 옵션
export interface TagOption {
  id: number;
  name: string;
  status: TagStatus;
}

// 시간표 생성 요청
export interface CreateScheduleDto {
  name: string;
  description?: string;
  tagIds?: number[];
  createdById: number;
  creatorEmail?: string;
  creatorRefreshToken?: string;
}

// 시간표 수정 요청
export interface UpdateScheduleDto {
  name?: string;
  description?: string;
  tagIds?: number[];
}
