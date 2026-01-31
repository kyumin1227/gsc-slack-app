.PHONY: db dev prod down logs backup clean

# DB만 실행 (로컬 개발용)
db:
	docker compose up db -d

# 개발 환경 (Docker로 앱 빌드 + 실행)
dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile app up --build

# 개발 환경 (백그라운드)
dev-d:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile app up --build -d

# 프로덕션 환경
prod:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile app up -d

# 전체 종료
down:
	docker compose --profile app down

# DB 종료 (로컬 개발용)
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
	docker compose --profile app down -v --remove-orphans
	docker system prune -f
