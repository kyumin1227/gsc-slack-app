.PHONY: db local local-d dev prod down-local down-dev down-prod down-db logs logs-app backup clean

# DB + Redis 실행 (로컬 개발용)
db:
	docker compose -f docker-compose.yml -f docker-compose.local.yml up -d; docker stop gsc-slack-app 2>/dev/null || true

# 로컬 환경 (소스 빌드 + 실행)
local:
	docker compose -f docker-compose.yml -f docker-compose.local.yml up --build

# 로컬 환경 (백그라운드)
local-d:
	docker compose -f docker-compose.yml -f docker-compose.local.yml up --build -d

# 개발(스테이징) 환경 - 학교 서버용
dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# 프로덕션 환경
prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 로컬 환경 종료
down-local:
	docker compose -f docker-compose.yml -f docker-compose.local.yml down

# 개발(스테이징) 환경 종료
down-dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml down

# 프로덕션 환경 종료
down-prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# DB + Redis 종료 (로컬 개발용)
down-db:
	docker compose down

# 로그 확인
logs:
	docker compose logs -f

# 앱 로그만 확인
logs-app:
	docker logs -f gsc-slack-app

# DB 백업
backup:
	@mkdir -p backups
	docker exec gsc-postgres pg_dump -U postgres gsc_slack_app > backups/backup_$$(date +%Y%m%d_%H%M%S).sql
	@echo "✅ Backup completed: backups/"

# 미사용 Docker 리소스 정리
clean:
	docker compose -f docker-compose.yml -f docker-compose.local.yml down -v --remove-orphans
	docker system prune -f
