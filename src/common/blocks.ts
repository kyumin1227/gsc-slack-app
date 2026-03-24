/**
 * 공통 Slack Block Kit 블록 빌더
 */

export function multiUsersSelectBlock(params: {
  blockId: string;
  actionId: string;
  label: string;
  placeholder: string;
  initialUsers?: string[];
  optional?: boolean;
}) {
  return {
    type: 'input' as const,
    block_id: params.blockId,
    optional: params.optional ?? false,
    label: { type: 'plain_text' as const, text: params.label },
    element: {
      type: 'multi_users_select' as const,
      action_id: params.actionId,
      placeholder: {
        type: 'plain_text' as const,
        text: params.placeholder,
      },
      ...((params.initialUsers?.length ?? 0) > 0 && {
        initial_users: params.initialUsers,
      }),
    },
  };
}
