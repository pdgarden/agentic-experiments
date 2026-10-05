import asyncio
from pathlib import Path

import pytest

from src.events import RunFinished, TextDelta
from src.parts import TextPart
from src.store.db import connect, migrate, migration_files
from src.store.repo import RunConflict, Store


@pytest.fixture
async def store(tmp_path: Path):
    conn = await connect(tmp_path / "app.db")
    yield Store(conn)
    await conn.close()


async def test_migrations_apply_once(tmp_path: Path) -> None:
    conn = await connect(tmp_path / "app.db")
    latest = len(migration_files())
    assert await migrate(conn) == latest  # second run is a no-op
    async with conn.execute("PRAGMA journal_mode") as cursor:
        row = await cursor.fetchone()
    assert row is not None and row[0] == "wal"
    await conn.close()


async def test_session_crud(store: Store) -> None:
    first = await store.create_session("assistant")
    second = await store.create_session("assistant", title="Named")
    assert first.title == ""

    listed = await store.list_sessions()
    assert {s.id for s in listed} == {first.id, second.id}

    renamed = await store.rename_session(first.id, "Renamed")
    assert renamed is not None and renamed.title == "Renamed"
    await store.set_title_if_empty(first.id, "ignored")
    unchanged = await store.get_session(first.id)
    assert unchanged is not None and unchanged.title == "Renamed"

    assert await store.delete_session(first.id)
    assert not await store.delete_session(first.id)
    assert await store.get_session(first.id) is None


async def test_one_running_run_per_session(store: Store) -> None:
    session = await store.create_session("assistant")
    parts = [TextPart(text="hi")]
    run = await store.create_run(session.id, parts)
    with pytest.raises(RunConflict):
        await store.create_run(session.id, parts)

    await store.finish_run(run.id, "succeeded")
    second = await store.create_run(session.id, parts)
    assert second.status == "running"


async def test_delete_cascades_to_runs_and_events(store: Store) -> None:
    session = await store.create_session("assistant")
    run = await store.create_run(session.id, [TextPart(text="hi")])
    await store.append_event(
        TextDelta(run_id=run.id, seq=1, segment_id="s1", delta="x")
    )

    await store.delete_session(session.id)
    assert await store.get_run(run.id) is None
    assert await store.list_events(run.id) == []


async def test_events_roundtrip_and_after(store: Store) -> None:
    session = await store.create_session("assistant")
    run = await store.create_run(session.id, [TextPart(text="hi")])
    for seq in (1, 2, 3):
        await store.append_event(
            TextDelta(run_id=run.id, seq=seq, segment_id="s1", delta=str(seq))
        )

    events = await store.list_events(run.id, after=1)
    assert [e.seq for e in events] == [2, 3]
    assert isinstance(events[0], TextDelta) and events[0].delta == "2"
    assert list((await store.events_by_run(session.id)).keys()) == [run.id]


async def test_interrupt_running_runs(store: Store) -> None:
    session = await store.create_session("assistant")
    run = await store.create_run(session.id, [TextPart(text="hi")])
    await store.append_event(
        TextDelta(run_id=run.id, seq=1, segment_id="s1", delta="x")
    )

    assert await store.interrupt_running_runs() == [run.id]

    stored = await store.get_run(run.id)
    assert stored is not None and stored.status == "interrupted"
    last = (await store.list_events(run.id))[-1]
    assert isinstance(last, RunFinished)
    assert (last.seq, last.status) == (2, "interrupted")
    assert await store.interrupt_running_runs() == []


async def test_reads_do_not_hold_a_snapshot_across_awaits(tmp_path: Path) -> None:
    """Writes stay possible while a read runs and another connection commits.

    The store shares one connection between coroutines. A read that keeps its
    cursor open across awaits holds a WAL snapshot; an insert interleaved on that
    connection after another connection's commit (the SDK session's) then fails
    at once with "database is locked", whatever the busy timeout.
    """
    conn = await connect(tmp_path / "app.db")
    other = await connect(tmp_path / "app.db")
    store, sdk_like = Store(conn), Store(other)
    session = await store.create_session("assistant")
    run = await store.create_run(session.id, [TextPart(text="hi")])
    for seq in range(1, 301):
        await store.append_event(
            TextDelta(run_id=run.id, seq=seq, segment_id="s1", delta="x")
        )

    async def write() -> None:
        for seq in range(301, 341):
            await sdk_like.create_session("assistant")
            await store.append_event(
                TextDelta(run_id=run.id, seq=seq, segment_id="s1", delta="y")
            )

    async def read() -> None:
        for _ in range(20):
            await store.events_by_run(session.id)
            await store.list_events(run.id)

    try:
        await asyncio.gather(write(), read(), read())
        assert len(await store.list_events(run.id)) == 340
    finally:
        await other.close()
        await conn.close()
