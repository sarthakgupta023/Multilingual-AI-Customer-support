FROM node:22-alpine AS frontend
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client ./
RUN npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 NODE_ENV=production PORT=4000
WORKDIR /app
COPY server/requirements.txt ./server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt
COPY server/app ./server/app
COPY data/policies ./data/policies
COPY --from=frontend /app/client/dist ./client/dist
RUN useradd --create-home appuser
USER appuser
EXPOSE 4000
CMD ["sh", "-c", "exec uvicorn server.app.main:app --host 0.0.0.0 --port ${PORT}"]
