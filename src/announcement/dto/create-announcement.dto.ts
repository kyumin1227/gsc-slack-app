export interface CreateAnnouncementDto {
  channelId: string;
  messageTs: string;
  title: string;
  content: string;
  authorSlackId: string;
}

export interface UpdateAnnouncementDto {
  title: string;
  content: string;
}
