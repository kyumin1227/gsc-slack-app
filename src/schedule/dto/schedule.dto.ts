export interface CreateScheduleDto {
  name: string;
  description?: string;
  tagIds?: number[];
  createdById: number;
  creatorEmail?: string;
  creatorRefreshToken?: string;
}

export interface UpdateScheduleDto {
  name?: string;
  description?: string;
  tagIds?: number[];
}
