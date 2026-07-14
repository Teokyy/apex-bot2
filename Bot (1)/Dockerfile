FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY auto_poster.py .
COPY birthdays.json .
CMD ["python", "auto_poster.py"]
