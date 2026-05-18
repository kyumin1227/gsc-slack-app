export interface CreateAnnouncementDto {
  channelId: string;
  messageTs: string;
  title: string;
  content: string;
  authorId: number;
}

export interface UpdateAnnouncementDto {
  title: string;
  content: string;
}
