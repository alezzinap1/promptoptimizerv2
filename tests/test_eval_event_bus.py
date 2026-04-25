"""Pub/sub event bus for live eval-run progress."""
from __future__ import annotations

import threading
import time

from services.eval.event_bus import EvalEventBus


def test_subscribe_then_publish_delivers() -> None:
    bus = EvalEventBus()
    q = bus.subscribe(run_id=1)
    bus.publish(1, {"type": "started"})
    bus.publish(1, {"type": "progress", "n": 1})
    bus.publish(1, {"type": "done"})
    seen = []
    while not q.empty():
        seen.append(q.get_nowait())
    assert [e["type"] for e in seen] == ["started", "progress", "done"]


def test_publish_before_subscribe_is_replayed() -> None:
    bus = EvalEventBus()
    bus.publish(7, {"type": "started"})
    bus.publish(7, {"type": "progress", "n": 1})
    history = bus.replay(7)
    assert [e["type"] for e in history] == ["started", "progress"]
    q = bus.subscribe(7)
    bus.publish(7, {"type": "done"})
    seen = []
    while not q.empty():
        seen.append(q.get_nowait())
    # Subscriber gets only events published AFTER subscribing.
    assert [e["type"] for e in seen] == ["done"]


def test_is_active_until_done_event() -> None:
    bus = EvalEventBus()
    assert bus.is_active(2) is False
    bus.publish(2, {"type": "started"})
    assert bus.is_active(2) is True
    bus.publish(2, {"type": "done", "status": "completed"})
    assert bus.is_active(2) is False


def test_unsubscribe_stops_delivery() -> None:
    bus = EvalEventBus()
    q = bus.subscribe(3)
    bus.publish(3, {"type": "started"})
    bus.unsubscribe(3, q)
    bus.publish(3, {"type": "progress", "n": 1})
    seen = []
    while not q.empty():
        seen.append(q.get_nowait())
    assert [e["type"] for e in seen] == ["started"]


def test_thread_safe_concurrent_publish() -> None:
    bus = EvalEventBus()
    q = bus.subscribe(99)
    n_threads = 8
    n_per_thread = 25

    def producer(idx: int) -> None:
        for i in range(n_per_thread):
            bus.publish(99, {"type": "progress", "thread": idx, "i": i})

    threads = [threading.Thread(target=producer, args=(t,)) for t in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    time.sleep(0.05)
    received = 0
    while not q.empty():
        q.get_nowait()
        received += 1
    assert received == n_threads * n_per_thread


def test_replay_buffer_capped() -> None:
    bus = EvalEventBus(max_history_per_run=5)
    for i in range(20):
        bus.publish(11, {"type": "progress", "i": i})
    h = bus.replay(11)
    assert len(h) == 5
    assert h[0]["i"] == 15  # last 5
    assert h[-1]["i"] == 19


def test_multiple_runs_isolated() -> None:
    bus = EvalEventBus()
    qa = bus.subscribe(100)
    qb = bus.subscribe(200)
    bus.publish(100, {"type": "a"})
    bus.publish(200, {"type": "b"})
    a_evts = []
    while not qa.empty():
        a_evts.append(qa.get_nowait())
    b_evts = []
    while not qb.empty():
        b_evts.append(qb.get_nowait())
    assert [e["type"] for e in a_evts] == ["a"]
    assert [e["type"] for e in b_evts] == ["b"]
