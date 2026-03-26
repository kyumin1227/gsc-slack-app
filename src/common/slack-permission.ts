import type { WebClient } from '@slack/web-api';
import { UserService } from '../user/user.service';

const PERMISSION_DENIED_MSG = '이 명령어는 조교 이상 권한이 필요합니다.';

export async function requireAdmin(
  userService: UserService,
  userId: string,
  client: WebClient,
  channelId?: string,
): Promise<boolean> {
  if (await userService.isAdmin(userId)) return true;

  try {
    if (channelId) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: PERMISSION_DENIED_MSG,
      });
    } else {
      await client.chat.postMessage({
        channel: userId,
        text: PERMISSION_DENIED_MSG,
      });
    }
  } catch {
    // 메시지 전송 실패 시 무시
  }
  return false;
}
