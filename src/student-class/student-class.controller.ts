import { Controller } from '@nestjs/common';
import { BusinessError, ErrorCode } from '../common/errors';
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
  @Action('home:open-class-list')
  async listClasses({
    ack,
    client,
    body,
  }: (SlackCommandMiddlewareArgs | SlackActionMiddlewareArgs<BlockAction>) &
    AllMiddlewareArgs) {
    await ack();

    const userId = 'user_id' in body ? body.user_id : body.user.id;
    await this.permissionService.requireAdmin(userId);

    const classes = await this.studentClassService.findAllClasses();

    await client.views.open({
      trigger_id: body.trigger_id,
      view: StudentClassView.listModal(
        classes.map((c) => ({
          id: c.id,
          name: c.name,
          section: c.section,
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
  @Action('home:open-class-create')
  async openCreateModal({
    ack,
    client,
    body,
  }: (SlackCommandMiddlewareArgs | SlackActionMiddlewareArgs<BlockAction>) &
    AllMiddlewareArgs) {
    await ack();

    const userId = 'user_id' in body ? body.user_id : body.user.id;
    await this.permissionService.requireAdmin(userId);

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
    const channelResult = await client.conversations
      .create({ name: channelName, is_private: false })
      .catch((e: any) => {
        if (e?.data?.error === 'name_taken')
          throw new BusinessError(ErrorCode.CHANNEL_NAME_TAKEN);
        throw e;
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
  }

  // 반 목록 overflow (편집 / 졸업처리 / 활성화)
  @Action('student-class:list:overflow')
  async handleOverflow({
    ack,
    body,
    client,
    logger,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { selected_option: { value: string } };
    const [op, idStr] = action.selected_option.value.split(':');
    const classId = parseInt(idStr, 10);

    if (op === 'edit') {
      const cls = await this.studentClassService.findById(classId);
      if (!cls) return;

      await client.views.push({
        trigger_id: body.trigger_id,
        view: StudentClassView.editModal({
          id: cls.id,
          name: cls.name,
          graduationYear: cls.graduationYear,
          slackChannelId: cls.slackChannelId,
        }),
      });
      return;
    }

    if (op === 'delete') {
      const cls = await this.studentClassService.findById(classId);
      if (!cls) return;
      await client.views.push({
        trigger_id: body.trigger_id,
        view: StudentClassView.deleteConfirmModal(classId, cls.name),
      });
      return;
    }

    if (op === 'graduate') {
      await this.studentClassService.graduateClass(classId);
      logger.info(`StudentClass ${classId} graduated`);
    } else if (op === 'activate') {
      await this.studentClassService.activateClass(classId);
      logger.info(`StudentClass ${classId} activated`);
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
            section: c.section,
            admissionYear: c.admissionYear,
            graduationYear: c.graduationYear,
            status: c.status,
            slackChannelId: c.slackChannelId ?? undefined,
          })),
        ),
      });
    }
  }

  // 반 편집 제출
  @View('student-class:modal:edit')
  async handleEdit({ ack, view }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const { classId } = JSON.parse(view.private_metadata || '{}') as {
      classId: number;
    };
    const values = view.state.values;

    const graduationYearStr =
      values.graduation_year_block.graduation_year_input.value ?? '';
    const graduationYear = parseInt(graduationYearStr, 10);

    if (isNaN(graduationYear) || graduationYear < 2000) {
      await ack({
        response_action: 'errors',
        errors: { graduation_year_block: '올바른 졸업연도를 입력해주세요.' },
      });
      return;
    }

    const slackChannelId =
      values.slack_channel_block.slack_channel_input.selected_conversation ??
      null;

    await ack();

    await this.studentClassService.updateClass(classId, {
      graduationYear,
      ...(slackChannelId !== null ? { slackChannelId } : {}),
    });
  }

  // 반 삭제 확인 모달 제출 → 소프트 삭제
  @View('student-class:modal:delete')
  async handleDelete({
    ack,
    body,
    view,
    client,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    await ack();

    const classId = parseInt(view.private_metadata, 10);
    await this.studentClassService.deleteClass(classId);

    logger.info(`StudentClass ${classId} deleted by ${body.user.id}`);
    await client.chat.postMessage({
      channel: body.user.id,
      text: '✅ 반이 삭제되었습니다.',
    });
  }
}
