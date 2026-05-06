# AISEO — Development Makefile
# Usage: make <target>

.PHONY: dev build rebuild up migrate migrate-deploy logs stop clean

dev:
	@echo "Starting infrastructure (Postgres + Redis)..."
	docker compose up db redis -d
	@echo "✅ Infrastructure ready. Run 'pnpm dev' to start the app."

build:
	docker compose build

rebuild:
	docker compose build --no-cache

up:
	docker compose up

migrate:
	pnpm exec prisma migrate dev

migrate-deploy:
	pnpm exec prisma migrate deploy

logs:
	docker compose logs -f

stop:
	docker compose down

clean:
	@echo "⚠️  This will destroy all Docker volumes including the database."
	docker compose down -v
