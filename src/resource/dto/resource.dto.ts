import { ResourceType } from '../resource.entity';

// 리소스(스터디룸/교실/교수 캘린더) 생성 요청
export interface CreateResourceDto {
  name: string;
  type?: ResourceType;
  aliases?: string[];
  description?: string;
  isDefault?: boolean;
}
