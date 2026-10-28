FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py broker.py broker_routes.py upstream.py ./

RUN useradd --uid 1000 --create-home broker \
    && mkdir -p /app/state \
    && chown broker:broker /app/state \
    && chmod 700 /app/state
USER broker

EXPOSE 8000
CMD ["python", "app.py"]