"""Web search and fetch through the core capabilities, local tools only: the gateway carries no native tools.

- `web_search`: Tavily, only when `TAVILY_API_KEY` is set (the capability's tool is `tavily_search`).
- `web_fetch`: HTML -> Markdown, size-limited, with SSRF protection (no private or local addresses).
"""

import logging

from pydantic_ai.capabilities import AbstractCapability, WebFetch, WebSearch
from pydantic_ai.common_tools.tavily import tavily_search_tool
from pydantic_ai.common_tools.web_fetch import web_fetch_tool

from src.agent.build import Deps
from src.settings import Settings

logger = logging.getLogger(__name__)

WEB_FETCH_MAX_CHARS = 40_000
WEB_FETCH_TIMEOUT_SECONDS = 20
WEB_FETCH_MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024
SEARCH_MAX_RESULTS = 8


def web_capabilities(settings: Settings) -> list[AbstractCapability[Deps]]:
    capabilities: list[AbstractCapability[Deps]] = []
    if settings.tavily_api_key:
        capabilities.append(
            WebSearch(native=False, local=tavily_search_tool(settings.tavily_api_key, max_results=SEARCH_MAX_RESULTS))
        )
    else:
        logger.info("TAVILY_API_KEY is not set: no web search")
    blocked = settings.web_fetch_blocked_domains or None
    capabilities.append(
        WebFetch(
            native=False,
            local=web_fetch_tool(
                max_content_length=WEB_FETCH_MAX_CHARS,
                timeout=WEB_FETCH_TIMEOUT_SECONDS,
                max_download_bytes=WEB_FETCH_MAX_DOWNLOAD_BYTES,
                blocked_domains=blocked,
            ),
            blocked_domains=blocked,
        )
    )
    return capabilities
