"""Local development runner. Production uses the uvicorn command in the Dockerfile."""
import os

import uvicorn

if __name__ == "__main__":
    development = os.getenv("ENVIRONMENT", "development").lower() not in ("production", "prod")
    uvicorn.run(
        "app.main:app",
        host=os.getenv("HOST", "127.0.0.1"),  # local only by default; containers set HOST=0.0.0.0
        port=int(os.getenv("PORT", "8002")),
        reload=development,
        access_log=False,  # the application writes its own access log with secrets redacted
        server_header=False,
    )
