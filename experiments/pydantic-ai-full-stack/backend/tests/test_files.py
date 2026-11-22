from typing import Any

import httpx
from pydantic_ai.messages import BinaryContent, ModelRequest, UserPromptPart

from src.services import Services
from tests.helpers import chat, create_conversation

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


async def _upload(client: httpx.AsyncClient, name: str, data: bytes, media_type: str) -> httpx.Response:
    return await client.post("/api/files", files={"file": (name, data, media_type)}, data={"conversation_id": "c1"})


def _prompt_content(services_messages: list[Any]) -> list[Any]:
    request = services_messages[0]
    assert isinstance(request, ModelRequest)
    part = next(p for p in request.parts if isinstance(p, UserPromptPart))
    return list(part.content) if not isinstance(part.content, str) else [part.content]


async def test_image_attachment_reaches_model_as_binary(client: httpx.AsyncClient, services: Services) -> None:
    await create_conversation(client, "c1")
    r = await _upload(client, "a.png", PNG, "image/png")
    assert r.status_code == 200, r.text
    url = r.json()["url"]
    await chat(client, "c1", "what is this", files=[{"type": "file", "mediaType": "image/png", "url": url}])
    conversation = await services.store.load("c1")
    assert conversation is not None
    content = _prompt_content(conversation.messages)
    assert any(isinstance(c, BinaryContent) and c.data == PNG for c in content)
    assert (await client.get(url)).content == PNG


async def test_text_attachment_is_inlined(client: httpx.AsyncClient, services: Services) -> None:
    await create_conversation(client, "c1")
    r = await _upload(client, "data.csv", b"a,b\n1,2\n", "text/csv")
    url = r.json()["url"]
    await chat(client, "c1", "sum it", files=[{"type": "file", "mediaType": "text/csv", "url": url}])
    conversation = await services.store.load("c1")
    assert conversation is not None
    assert any("a,b\n1,2" in c for c in _prompt_content(conversation.messages) if isinstance(c, str))


async def test_upload_rules(client: httpx.AsyncClient, services: Services) -> None:
    assert (await _upload(client, "x.exe", b"MZ", "application/x-msdownload")).status_code == 415
    services.settings.max_upload_bytes = 10
    assert (await _upload(client, "big.txt", b"x" * 11, "text/plain")).status_code == 413


async def test_remote_urls_are_refused(client: httpx.AsyncClient) -> None:
    await create_conversation(client, "c1")
    body = {
        "trigger": "submit-message",
        "id": "c1",
        "messages": [
            {
                "id": "u1",
                "role": "user",
                "parts": [{"type": "file", "mediaType": "image/png", "url": "http://169.254.169.254/latest"}],
            }
        ],
    }
    assert (await client.post("/api/chat", json=body)).status_code == 422
