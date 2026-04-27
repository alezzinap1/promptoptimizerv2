"""prompt_library_revision: append, replace, star, list."""
from __future__ import annotations

from pathlib import Path

import pytest

from db.manager import DBManager


@pytest.fixture()
def db(tmp_path: Path) -> DBManager:
    m = DBManager(str(tmp_path / "librev.db"))
    m.init()
    return m


def test_new_card_creates_revision(db: DBManager) -> None:
    uid = 42
    lid = db.save_to_library("c1", "hello", user_id=uid, tags=[], techniques=[])
    items = db.get_library(user_id=uid)
    assert len(items) == 1
    assert items[0]["prompt"] == "hello"
    revs = items[0].get("revisions") or []
    assert len(revs) == 1
    assert revs[0]["version_seq"] == 1


def test_append_and_replace_latest(db: DBManager) -> None:
    uid = 7
    lid = db.save_to_library("c", "a", user_id=uid, tags=[], techniques=[])
    db.append_library_revision(lid, "b", uid, completeness_score=50.0, token_estimate=10)
    items = db.get_library(user_id=uid)
    revs = sorted((items[0].get("revisions") or []), key=lambda x: x["version_seq"])
    assert len(revs) == 2
    assert items[0]["prompt"] == "b"
    db.replace_latest_library_revision(lid, "b2", uid, completeness_score=90.0)
    full = db.list_library_revisions(lid, uid)
    assert full[0]["prompt"] == "b2"
    assert full[0]["version_seq"] == 2
    assert float(full[0]["completeness_score"] or 0) == 90.0


def test_star_and_clear(db: DBManager) -> None:
    uid = 3
    lid = db.save_to_library("s", "p", user_id=uid, tags=[], techniques=[])
    db.append_library_revision(lid, "p2", uid)
    revs = db.list_library_revisions(lid, uid)
    rid = revs[0]["id"]
    assert db.set_starred_library_revision(lid, int(rid), uid)
    items = db.get_library(user_id=uid)
    starred = [r for r in (items[0].get("revisions") or []) if r["is_starred"]]
    assert len(starred) == 1
    assert db.clear_starred_library_revisions(lid, uid)
    items = db.get_library(user_id=uid)
    assert not any(r.get("is_starred") for r in (items[0].get("revisions") or []))


def test_delete_cascades_revisions(db: DBManager) -> None:
    uid = 1
    lid = db.save_to_library("x", "y", user_id=uid, tags=[], techniques=[])
    db.append_library_revision(lid, "z", uid)
    db.delete_from_library(lid, user_id=uid)
    assert db.list_library_revisions(lid, uid) == []
