import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../user/user.entity';

@Entity()
export class Announcement {
  @PrimaryGeneratedColumn()
  id: number;

  /** Slack 채널 ID (C...) */
  @Column()
  channelId: string;

  /** chat.postMessage response.ts — chat.update 키 */
  @Column()
  messageTs: string;

  /** 공지 제목 */
  @Column()
  title: string;

  /** 공지 내용 */
  @Column('text')
  content: string;

  /** 작성자 (admin만 확인 가능) */
  @ManyToOne(() => User, { eager: true })
  author: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
