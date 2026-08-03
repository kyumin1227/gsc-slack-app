# Bannote Slack App

Bannote is a NestJS Slack app for GSC schedules, Google Calendar integration,
resource management, and study room bookings. It also exposes a remote MCP
server so MCP-capable clients can use the same booking tools outside Slack.

## Local Setup

```bash
npm install
npm run build
npm run test
```

Run the app locally:

```bash
npm run start:dev
```

For local Postgres and Redis:

```bash
make db
```

## Remote MCP

The MCP endpoint is:

```text
https://<app-domain>/mcp
```

The server advertises OAuth metadata from:

```text
https://<app-domain>/.well-known/oauth-authorization-server
https://<app-domain>/.well-known/oauth-protected-resource/mcp
```

MCP authentication uses dynamic client registration, authorization code +
PKCE, and Google OAuth. The Google account email must match an existing
Bannote user.

### MCP Environment

| Variable                  | Purpose                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `MCP_BASE_URL`            | Public base URL used in OAuth and protected resource metadata.   |
| `MCP_GOOGLE_REDIRECT_URI` | Google OAuth callback URL for MCP auth.                          |
| `MCP_ALLOWED_ORIGINS`     | Optional comma-separated browser origins allowed to call `/mcp`. |

If `MCP_ALLOWED_ORIGINS` is empty, requests without an `Origin` header are
accepted and browser requests must match `MCP_BASE_URL`.

### MCP Tools

| Tool                      | Type  | Purpose                                            |
| ------------------------- | ----- | -------------------------------------------------- |
| `get_current_time`        | read  | Get current Asia/Seoul time.                       |
| `get_my_bookings`         | read  | List the authenticated user's study room bookings. |
| `find_user`               | read  | Find active users by name, code, or email.         |
| `get_study_rooms`         | read  | List study room IDs, names, and aliases.           |
| `check_room_availability` | read  | Check room availability for a time range.          |
| `book_room`               | write | Create a study room booking.                       |
| `cancel_booking`          | write | Cancel an existing booking.                        |
| `modify_booking`          | write | Modify an existing booking.                        |

Tools include MCP annotations and structured output so clients can distinguish
read-only lookups from booking mutations.

### MCP Prompts And Resources

Prompts:

- `reserve_study_room`
- `change_study_room_booking`
- `cancel_study_room_booking`
- `find_available_study_room`

Resources:

- `bannote://guide/study-room-booking`
- `bannote://guide/tool-workflows`
- `bannote://rooms`
- `bannote://me/bookings`

These provide workflow guidance and user-specific context without adding
client-specific skills.

## Verification

Targeted checks for MCP changes:

```bash
npm run test -- src/mcp/mcp.service.spec.ts src/mcp/mcp.controller.spec.ts src/tools/tools.service.spec.ts
npm run build
```

Health check:

```bash
curl -i https://<app-domain>/health
```

Unauthenticated MCP requests should return `401` with a `WWW-Authenticate`
challenge that points to the MCP protected resource metadata.

## Deployment

Production infrastructure is defined in `terraform/`. The production app domain
is configured through `app_domain`, and the ECS task sets:

- `MCP_BASE_URL=https://${app_domain}`
- `MCP_GOOGLE_REDIRECT_URI=https://${app_domain}/mcp/auth/callback`
