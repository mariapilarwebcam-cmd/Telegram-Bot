from fastapi import FastAPI

app = FastAPI()

@app.get("/")
async def health_check():
    return {"status": "healthy", "service": "telegram-bot-api"}

@app.get("/api/health")
async def health_check_full():
    return {"status": "healthy", "service": "telegram-bot-api"}