import { Controller } from '@nestjs/common';
import { Action, Command, View } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackCommandMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { StudentClassService } from './student-class.service';
import { StudentClassView } from './student-class.view';
import { ClassSection } from './student-class.entity';
import { CMD } from '../common/slack-commands';
import { PermissionService } from '../user/permission.service';

@Controller()
export class StudentClassController {
  constructor(
    private readonly studentClassService: StudentClassService,
    private readonly permissionService: PermissionService,
  ) {}

  // /반 - 반 목록 조회
  @Command(CMD.반)
  async listClasses({
    ack,
    client,
    body,
  }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    await this.permissionService.requireAdmin(body.user_id);

    const classes = await this.studentClassService.findAllClasses();

    await client.views.open({
      trigger_id: body.trigger_id,
      view: StudentClassView.listModal(
        classes.map((c) => ({
          id: c.id,
          name: c.name,
          admissionYear: c.admissionYear,
          graduationYear: c.graduationYear,
          status: c.status,
          slackChannelId: c.slackChannelId ?? undefined,
        })),
      ),
    });
  }

  // /반생성 - 반 생성 모달
  @Command(CMD.반생성)
  async openCreateModal({
    ack,
    client,
    body,
  }: SlackCommandMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    await this.permissionService.requireAdmin(body.user_id);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: StudentClassView.createModal(),
    });
  }

  // 반 생성 폼 제출
  @View('student-class:modal:create')
  async handleCreate({
    ack,
    body,
    view,
    client,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const values = view.state.values;
    const admissionYearStr =
      values.admission_year_block.admission_year_input.value ?? '';
    const admissionYear = parseInt(admissionYearStr, 10);
    const section = values.section_block.section_select.selected_option
      ?.value as ClassSection;
    const graduationYearStr =
      values.graduation_year_block.graduation_year_input.value ?? '';
    const graduationYear = parseInt(graduationYearStr, 10);

    // 유효성 검사 (ack 전)
    if (isNaN(admissionYear) || admissionYear < 2000) {
      await ack({
        response_action: 'errors',
        errors: { admission_year_block: '올바른 입학년도를 입력해주세요.' },
      });
      return;
    }

    if (isNaN(graduationYear) || graduationYear < 2000) {
      await ack({
        response_action: 'errors',
        errors: { graduation_year_block: '올바른 졸업연도를 입력해주세요.' },
      });
      return;
    }

    // 3초 제한 내 ack — 이후 작업은 DM으로 결과 전달
    await ack();

    try {
      const savedClass = await this.studentClassService.createClass({
        admissionYear,
        section,
        graduationYear,
      });

      // Slack 채널 생성 (채널명: "2024-a" 형식, ASCII 규칙 준수)
      const channelName = StudentClassService.buildChannelName(
        admissionYear,
        section,
      );
      const channelResult = await client.conversations.create({
        name: channelName,
        is_private: false,
      });

      const channelId = channelResult.channel?.id;
      if (channelId) {
        // 채널 topic에 반 이름 표시 (한국어 가능)
        await client.conversations.setTopic({
          channel: channelId,
          topic: savedClass.name,
        });
        await this.studentClassService.updateSlackChannel(
          savedClass.id,
          channelId,
        );
      }

      await client.chat.postMessage({
        channel: body.user.id,
        text:
          `반 "${savedClass.name}"이(가) 생성되었습니다.\n` +
          `• 태그 자동 생성 완료\n` +
          `• Slack 채널 ${channelId ? `<#${channelId}>` : `\`${channelName}\``} 생성 완료`,
      });

      logger.info(
        `StudentClass created: ${savedClass.name}, channelId: ${channelId ?? 'none'}`,
      );
    } catch (error: any) {
      logger.error('Create class error:', error);

      const isDuplicate =
        error.code === '23505' || error.data?.error === 'name_taken';
      await client.chat.postMessage({
        channel: body.user.id,
        text: isDuplicate
          ? `이미 존재하는 반 또는 채널입니다.`
          : `반 생성 중 오류가 발생했습니다: ${error.message ?? '알 수 없는 오류'}`,
      });
    }
  }

  // 반 상태 토글 (활성화/졸업)
  @Action(/^student-class:list:toggle:/)
  async handleToggle({
    ack,
    body,
    client,
    logger,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    try {
      const action = body.actions[0] as { action_id: string; value: string };
      const classId = parseInt(action.action_id.split(':').pop()!, 10);
      const toggleAction = action.value;

      if (toggleAction === 'graduate') {
        await this.studentClassService.graduateClass(classId);
      } else if (toggleAction === 'activate') {
        await this.studentClassService.activateClass(classId);
      }

      // 목록 새로고침
      const classes = await this.studentClassService.findAllClasses();

      if (body.view?.id) {
        await client.views.update({
          view_id: body.view.id,
          view: StudentClassView.listModal(
            classes.map((c) => ({
              id: c.id,
              name: c.name,
              admissionYear: c.admissionYear,
              graduationYear: c.graduationYear,
              status: c.status,
              slackChannelId: c.slackChannelId ?? undefined,
            })),
          ),
        });
      }

      logger.info(`StudentClass ${classId} toggled to ${toggleAction}`);
    } catch (error) {
      logger.error('Toggle class error:', error);
    }
  }
}
