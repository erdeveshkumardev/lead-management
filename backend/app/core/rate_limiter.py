import time
from collections import defaultdict
from typing import Dict, List, Tuple
from fastapi import HTTPException, status


class SlidingWindowRateLimiter:
    """
    In-memory thread-safe sliding window rate limiter.
    Limits requests per key (e.g., client IP or IP + tenant).
    """
    def __init__(self, max_requests: int = 10, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: Dict[str, List[float]] = defaultdict(list)
        self.last_cleanup = time.time()

    def check(self, key: str) -> Tuple[bool, int]:
        """
        Checks if key exceeded rate limit.
        Returns (is_allowed, remaining_requests).
        """
        now = time.time()

        # Periodic cleanup of stale keys every 5 minutes
        if now - self.last_cleanup > 300:
            self._cleanup(now)
            self.last_cleanup = now

        timestamps = self.requests[key]
        cutoff = now - self.window_seconds
        active_timestamps = [t for t in timestamps if t > cutoff]
        self.requests[key] = active_timestamps

        if len(active_timestamps) >= self.max_requests:
            return False, 0

        active_timestamps.append(now)
        remaining = self.max_requests - len(active_timestamps)
        return True, remaining

    def _cleanup(self, now: float):
        cutoff = now - self.window_seconds
        dead_keys = []
        for k, timestamps in self.requests.items():
            valid = [t for t in timestamps if t > cutoff]
            if not valid:
                dead_keys.append(k)
            else:
                self.requests[k] = valid
        for k in dead_keys:
            del self.requests[k]


# Global rate limiter instance for webhook endpoints: max 10 requests per 60 seconds per IP
webhook_rate_limiter = SlidingWindowRateLimiter(max_requests=10, window_seconds=60)
