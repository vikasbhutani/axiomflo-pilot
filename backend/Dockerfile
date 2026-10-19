# The AxiomFlo Agent's private web service (Cloud Run service `axiomflo-agent`).
# Build context: this backend/ folder. See docs/agent/deploy.md.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 AXIOMFLO_DATA_SOURCE=axiomflo_api
WORKDIR /app

COPY pyproject.toml ./
COPY axiomflo ./axiomflo
RUN pip install --no-cache-dir . && useradd --create-home agent
USER agent

# Cloud Run sets PORT.
CMD ["sh", "-c", "exec uvicorn axiomflo.http_service:app --host 0.0.0.0 --port ${PORT:-8080} --no-server-header"]
