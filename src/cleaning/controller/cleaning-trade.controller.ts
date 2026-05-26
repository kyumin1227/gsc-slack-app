import { Controller } from '@nestjs/common';
import { Action, View } from 'nestjs-slack-bolt';
import type {
  AllMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackViewMiddlewareArgs,
  BlockAction,
} from '@slack/bolt';
import { CleaningTradeService } from '../service/cleaning-trade.service';
import { CleaningRuleService } from '../service/cleaning-rule.service';
import { CleaningTradeView } from '../view/cleaning-trade.view';
import { PermissionService } from '../../user/service/permission.service';
import { UserService } from '../../user/service/user.service';
import { UserRole } from '../../user/user.entity';
import { formatClassLabel } from '../../common/class-label.util';
import { StudentClassStatus } from '../../student-class/student-class.entity';
import { BusinessError, CleaningErrorCode } from '../../common/errors';

@Controller()
export class CleaningTradeController {
  constructor(
    private readonly cleaningTradeService: CleaningTradeService,
    private readonly cleaningRuleService: CleaningRuleService,
    private readonly permissionService: PermissionService,
    private readonly userService: UserService,
  ) {}

  // 사용자의 예정 청소 배정 목록을 연다.
  @Action('cleaning:my:open')
  async openMyAssignments({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const user = await this.userService.findBySlackId(body.user.id);
    if (!user) return;

    const assignments = await this.cleaningTradeService.getMyAssignments(
      user.id,
    );
    await client.views.open({
      trigger_id: body.trigger_id,
      view: CleaningTradeView.myAssignmentsModal(assignments),
    });
  }

  // 사용자가 보낸 대기 중 교환 요청 목록을 연다.
  @Action('cleaning:trade:open-requests')
  async openPendingRequests({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const user = await this.userService.findBySlackId(body.user.id);
    if (!user) return;

    const requests = await this.cleaningTradeService.getMyPendingRequests(
      user.id,
    );
    await client.views.open({
      trigger_id: body.trigger_id,
      view: CleaningTradeView.myPendingRequestsModal(requests),
    });
  }

  @Action('cleaning:trade:cancel')
  async cancelTrade({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { value: string };
    const tradeId = parseInt(action.value, 10);
    const user = await this.userService.findBySlackId(body.user.id);
    if (!user) return;

    await this.cleaningTradeService.cancelTrade(tradeId, user.id);

    const requests = await this.cleaningTradeService.getMyPendingRequests(
      user.id,
    );
    if (body.view?.id) {
      await client.views.update({
        view_id: body.view.id,
        view: CleaningTradeView.myPendingRequestsModal(requests),
      });
    }
  }

  @Action('cleaning:trade:open')
  async openTradeTarget({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { value: string };
    const assignmentId = parseInt(action.value, 10);
    const user = await this.userService.findBySlackId(body.user.id);
    if (!user) return;

    const [myAssignment, targets] = await Promise.all([
      this.cleaningTradeService.getAssignmentDetail(assignmentId),
      this.cleaningTradeService.getTradeTargets(assignmentId, user.id),
    ]);
    if (!myAssignment) return;

    await client.views.push({
      trigger_id: body.trigger_id,
      view: CleaningTradeView.tradeTargetModal(myAssignment, targets),
    });
  }

  // 사용자가 선택한 상대 배정으로 교환 요청을 만들고 양쪽에 알린다.
  @View('cleaning:modal:trade')
  async handleTrade({
    ack,
    view,
    body,
    client,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const myAssignmentId = parseInt(view.private_metadata, 10);
    const targetAssignmentId = parseInt(
      view.state.values.target_block.target_select.selected_option?.value ?? '',
      10,
    );

    if (isNaN(targetAssignmentId)) {
      await ack({
        response_action: 'errors',
        errors: { target_block: '대상을 선택해주세요.' },
      });
      return;
    }

    const user = await this.userService.findBySlackId(body.user.id);
    if (!user) {
      await ack();
      return;
    }

    let tradeId: number;
    try {
      const trade = await this.cleaningTradeService.requestTrade(
        myAssignmentId,
        targetAssignmentId,
      );
      tradeId = trade.id;
    } catch (e) {
      if (
        e instanceof BusinessError &&
        e.code === CleaningErrorCode.TRADE_ALREADY_PENDING
      ) {
        await ack({
          response_action: 'errors',
          errors: { target_block: e.message },
        });
        return;
      }
      throw e;
    }

    await ack();

    const details = await this.cleaningTradeService.getTradeWithDetails(
      tradeId,
    );
    if (details) {
      await Promise.allSettled([
        client.chat.postMessage({
          channel: details.target.userSlackId,
          text: '청소 교환 요청이 도착했습니다.',
          blocks: CleaningTradeView.tradeRequestBlocks(
            details.requester,
            details.target,
            tradeId,
          ),
        }),
        client.chat.postMessage({
          channel: details.requester.userSlackId,
          text: `교환 요청을 보냈습니다. *${details.target.cleaningDate}* (${details.target.resourceName}) — <@${details.target.userSlackId}>\n수락을 기다리는 중입니다.`,
        }),
      ]);
    }

    logger.info(`Trade ${tradeId} requested by ${body.user.id}`);
  }

  // 교환 요청 수락 시 실제 배정을 맞바꾸고 양쪽 메시지를 갱신한다.
  @Action('cleaning:trade:accept')
  async acceptTrade({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { value: string };
    const tradeId = parseInt(action.value, 10);
    const user = await this.userService.findBySlackId(body.user.id);
    if (!user) return;

    const details = await this.cleaningTradeService.getTradeWithDetails(
      tradeId,
    );

    try {
      await this.cleaningTradeService.respondTrade(tradeId, user.id, true);
    } catch (e) {
      if (
        e instanceof BusinessError &&
        (e.code === CleaningErrorCode.TRADE_FORBIDDEN ||
          e.code === CleaningErrorCode.TRADE_NOT_PENDING ||
          e.code === CleaningErrorCode.TRADE_DUPLICATE_ASSIGNEE)
      ) {
        await updateMessageOnError(client, body);
        return;
      }
      throw e;
    }

    if (details) {
      const { requester, target } = details;
      const resultBlocks = CleaningTradeView.tradeResultBlocks(
        requester,
        target,
        true,
      );
      const ch = (body as any).channel?.id;
      const ts = (body as any).message?.ts;
      await Promise.allSettled([
        ch && ts
          ? client.chat.update({
              channel: ch,
              ts,
              text: '교환 수락됨 ✅',
              blocks: resultBlocks,
            })
          : Promise.resolve(),
        client.chat.postMessage({
          channel: requester.userSlackId,
          text: '교환 요청이 수락되었습니다.',
          blocks: CleaningTradeView.tradeResultBlocks(requester, target, true, 'requester'),
        }),
      ]);
    }
  }

  // 교환 요청 거절 시 요청자에게 결과를 알리고 원본 메시지를 갱신한다.
  @Action('cleaning:trade:reject')
  async rejectTrade({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const action = body.actions[0] as { value: string };
    const tradeId = parseInt(action.value, 10);
    const user = await this.userService.findBySlackId(body.user.id);
    if (!user) return;

    const details = await this.cleaningTradeService.getTradeWithDetails(
      tradeId,
    );

    try {
      await this.cleaningTradeService.respondTrade(tradeId, user.id, false);
    } catch (e) {
      if (
        e instanceof BusinessError &&
        (e.code === CleaningErrorCode.TRADE_FORBIDDEN ||
          e.code === CleaningErrorCode.TRADE_NOT_PENDING)
      ) {
        await updateMessageOnError(client, body);
        return;
      }
      throw e;
    }

    if (details) {
      const { requester, target } = details;
      const resultBlocks = CleaningTradeView.tradeResultBlocks(
        requester,
        target,
        false,
      );
      const ch = (body as any).channel?.id;
      const ts = (body as any).message?.ts;
      await Promise.allSettled([
        ch && ts
          ? client.chat.update({
              channel: ch,
              ts,
              text: '교환 거절됨 ❌',
              blocks: resultBlocks,
            })
          : Promise.resolve(),
        client.chat.postMessage({
          channel: requester.userSlackId,
          text: '교환 요청이 거절되었습니다.',
          blocks: CleaningTradeView.tradeResultBlocks(requester, target, false, 'requester', target.userSlackId),
        }),
      ]);
    }
  }

  @Action('cleaning:swap:open')
  async openSwapManageList({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    const user = await this.permissionService.requireAdminOrClassRep(
      body.user.id,
    );
    const classId =
      user.role === UserRole.CLASS_REP ? user.studentClassId : undefined;
    const rules = await this.cleaningRuleService.findAllWithDetails(classId);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: CleaningTradeView.swapManageListModal(rules),
    });
  }

  @Action('cleaning:swap:open-select')
  async openSwapSelect({
    ack,
    client,
    body,
  }: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) {
    await ack();

    await this.permissionService.requireAdminOrClassRep(body.user.id);
    const action = body.actions[0] as { value: string };
    const ruleId = parseInt(action.value, 10);

    const [rule, assignments] = await Promise.all([
      this.cleaningRuleService.findOneWithDetails(ruleId),
      this.cleaningTradeService.getAssignmentsByRule(ruleId),
    ]);
    if (!rule) return;

    const ruleLabel = formatClassLabel({
      admissionYear: rule.studentClass.admissionYear,
      section: rule.studentClass.section,
      graduated: rule.studentClass.status === StudentClassStatus.GRADUATED,
    });

    await client.views.push({
      trigger_id: body.trigger_id,
      view: CleaningTradeView.swapSelectModal(assignments, ruleLabel),
    });
  }

  // 관리자가 두 배정을 직접 맞바꾸고 당사자에게 알린다.
  @View('cleaning:modal:swap')
  async handleSwap({
    ack,
    view,
    body,
    client,
    logger,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs) {
    const firstId = parseInt(
      view.state.values.first_block.first_select.selected_option?.value ?? '',
      10,
    );
    const secondId = parseInt(
      view.state.values.second_block.second_select.selected_option?.value ?? '',
      10,
    );

    if (isNaN(firstId) || isNaN(secondId)) {
      await ack({
        response_action: 'errors',
        errors: { first_block: '배정을 선택해주세요.' },
      });
      return;
    }
    if (firstId === secondId) {
      await ack({
        response_action: 'errors',
        errors: { second_block: '서로 다른 배정을 선택하세요.' },
      });
      return;
    }

    const [a1, a2] = await Promise.all([
      this.cleaningTradeService.getAssignmentDetail(firstId),
      this.cleaningTradeService.getAssignmentDetail(secondId),
    ]);

    try {
      await this.cleaningTradeService.swapAssignments(firstId, secondId);
    } catch (e) {
      if (
        e instanceof BusinessError &&
        (e.code === CleaningErrorCode.TRADE_SAME_SCHEDULE ||
          e.code === CleaningErrorCode.TRADE_DUPLICATE_ASSIGNEE)
      ) {
        await ack({
          response_action: 'errors',
          errors: { second_block: e.message },
        });
        return;
      }
      throw e;
    }

    await ack();

    if (a1 && a2) {
      await Promise.allSettled([
        client.chat.postMessage({
          channel: a1.userSlackId,
          text: `🔄 *${a1.cleaningDate}* → *${a2.cleaningDate}* | ${a1.resourceName}\n관리자에 의해 청소 배정이 교환되었습니다.`,
        }),
        client.chat.postMessage({
          channel: a2.userSlackId,
          text: `🔄 *${a2.cleaningDate}* → *${a1.cleaningDate}* | ${a2.resourceName}\n관리자에 의해 청소 배정이 교환되었습니다.`,
        }),
      ]);
    }

    logger.info(
      `Swap executed by ${body.user.id}: assignment ${firstId} <-> ${secondId}`,
    );
  }
}

async function updateMessageOnError(client: any, body: any): Promise<void> {
  const ch = body.channel?.id;
  const ts = body.message?.ts;
  if (ch && ts) {
    await client.chat.update({
      channel: ch,
      ts,
      text: '청소 배정이 변경되어 교환 요청을 처리할 수 없습니다.',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '청소 배정이 변경되어 교환 요청을 처리할 수 없습니다.',
          },
        },
      ],
    });
  }
}
