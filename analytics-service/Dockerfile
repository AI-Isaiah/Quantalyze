FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (cached layer - only rebuilds when requirements.txt changes)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code (changes frequently, but deps layer is cached)
COPY . .

RUN adduser --disabled-password --no-create-home app
USER app

EXPOSE 8000

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
