FROM python:3.12-slim

WORKDIR /app

# procps/lm-sensors give psutil more to read on bare-metal hosts; harmless
# in containers where the corresponding files simply won't exist.
RUN apt-get update && apt-get install -y --no-install-recommends \
    procps \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend /app/backend

ENV DASHBOARD_CONFIG=/config/config.yml
ENV PYTHONUNBUFFERED=1

EXPOSE 8080

CMD ["uvicorn", "backend.api.main:app", "--host", "0.0.0.0", "--port", "8080"]
