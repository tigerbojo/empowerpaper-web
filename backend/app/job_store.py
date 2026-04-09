from dataclasses import dataclass
from threading import Lock


@dataclass
class JobState:
    paper_id: str
    job_id: str
    status: str = 'processing'
    cleaned_image_url: str | None = None
    error: str | None = None


class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, JobState] = {}
        self._lock = Lock()

    def create(self, paper_id: str, job_id: str) -> JobState:
        state = JobState(paper_id=paper_id, job_id=job_id)
        with self._lock:
            self._jobs[job_id] = state
        return state

    def get(self, job_id: str) -> JobState | None:
        with self._lock:
            return self._jobs.get(job_id)

    def complete(self, job_id: str, cleaned_image_url: str) -> None:
        with self._lock:
            state = self._jobs[job_id]
            state.status = 'completed'
            state.cleaned_image_url = cleaned_image_url
            state.error = None

    def fail(self, job_id: str, error: str) -> None:
        with self._lock:
            state = self._jobs[job_id]
            state.status = 'failed'
            state.error = error


job_store = JobStore()
