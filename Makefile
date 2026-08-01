image-smoke:
	docker compose -f api/compose.yaml config
	docker build --file api/Dockerfile --tag foigoi-api:test api
