"""In-process pub/sub for live evaluation-run events.

The run executor pushes ``{"type": ..., ...}`` dicts here as it works; the
SSE endpoint reads from a per-subscriber ``queue.Queue`` and serialises events
to ``data: <json>\\n\\n`` lines. The bus also keeps a small rolling history per
``run_id`` so that:

  * a client that connects 200ms *after* "started" still sees the earlier
    "started" event without polling
  * a client that briefly disconnects can re-attach and request a replay

Concurrency: ``threading.Lock`` guards the dict of subscriber lists; each
``queue.Queue`` is itself thread-safe so multiple workers in the
``ThreadPoolExecutor`` can publish in parallel without contention.

This is a pure in-memory bus. Multi-process / multi-host setups would need
Redis pub/sub or similar — out of scope for the MVP.
"""
from __future__ import annotations

import queue
import threading
from collections import defaultdict, deque

_DEFAULT_HISTORY = 200
_DEFAULT_QUEUE_MAX = 1000


class EvalEventBus:
    """Per-run pub/sub with bounded subscriber queues and a rolling history."""

    def __init__(
        self,
        max_history_per_run: int = _DEFAULT_HISTORY,
        max_queue_size: int = _DEFAULT_QUEUE_MAX,
    ) -> None:
        self._history: dict[int, deque[dict]] = defaultdict(
            lambda: deque(maxlen=max_history_per_run)
        )
        self._max_history = max_history_per_run
        self._max_queue = max_queue_size
        self._subscribers: dict[int, list["queue.Queue[dict]"]] = defaultdict(list)
        self._active: set[int] = set()
        self._lock = threading.Lock()

    def subscribe(self, run_id: int) -> "queue.Queue[dict]":
        """Register a new subscriber and return its queue (FIFO of dict events)."""
        q: "queue.Queue[dict]" = queue.Queue(maxsize=self._max_queue)
        with self._lock:
            self._subscribers[int(run_id)].append(q)
        return q

    def unsubscribe(self, run_id: int, q: "queue.Queue[dict]") -> None:
        """Remove a subscriber. Safe if already absent."""
        with self._lock:
            subs = self._subscribers.get(int(run_id))
            if not subs:
                return
            try:
                subs.remove(q)
            except ValueError:
                pass
            if not subs:
                self._subscribers.pop(int(run_id), None)

    def publish(self, run_id: int, event: dict) -> None:
        """Append to history and push to every live subscriber.

        ``"started"`` flips the run to active; ``"done"`` flips it back.
        Subscriber queues are best-effort: if a queue is full (slow consumer),
        the oldest event is dropped to keep the producer non-blocking.
        """
        rid = int(run_id)
        evt_type = event.get("type", "")
        with self._lock:
            self._history[rid].append(event)
            if evt_type == "started":
                self._active.add(rid)
            elif evt_type == "done":
                self._active.discard(rid)
            subs = list(self._subscribers.get(rid, ()))

        for q in subs:
            try:
                q.put_nowait(event)
            except queue.Full:
                try:
                    q.get_nowait()
                    q.put_nowait(event)
                except (queue.Empty, queue.Full):
                    pass

    def replay(self, run_id: int) -> list[dict]:
        """Return all buffered events for this run (chronological order)."""
        with self._lock:
            return list(self._history.get(int(run_id), ()))

    def is_active(self, run_id: int) -> bool:
        """Return True if the run has emitted ``started`` but not yet ``done``."""
        with self._lock:
            return int(run_id) in self._active

    def clear(self, run_id: int) -> None:
        """Drop history and subscribers for a finished run (after a grace period).

        Not used in the MVP — the bus is small enough to keep all history for
        the lifetime of the process. Exposed so a janitor task can prune later.
        """
        with self._lock:
            self._history.pop(int(run_id), None)
            self._subscribers.pop(int(run_id), None)
            self._active.discard(int(run_id))


# Module-level singleton used by run executor and SSE handler.
BUS = EvalEventBus()
