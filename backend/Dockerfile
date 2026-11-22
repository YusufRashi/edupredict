FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MPLBACKEND=Agg
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Models are trained reproducibly from the bundled UCI data, not copied from a laptop.
RUN python -m ml.train

RUN useradd --create-home --uid 1000 app && mkdir -p /app/uploads && chown -R app:app /app
USER app

CMD ["sh", "-c", "alembic upgrade head && python -m scripts.bootstrap && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
