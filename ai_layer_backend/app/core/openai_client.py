"""
Centralized OpenAI client factory.

Automatically uses Azure OpenAI (AI Foundry) when the Azure endpoint is configured,
and falls back to the standard OpenAI SDK when it is not.

Usage:
    from app.core.openai_client import get_openai_client, get_async_openai_client, DEPLOYMENT_MODEL

    # Sync
    client = get_openai_client()
    response = client.chat.completions.create(model=DEPLOYMENT_MODEL, ...)

    # Async
    client = get_async_openai_client()
    response = await client.chat.completions.create(model=DEPLOYMENT_MODEL, ...)
"""

import openai
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def _get_azure_base_url() -> str:
    """Strip trailing slash from endpoint for consistency."""
    return settings.AZURE_OPENAI_ENDPOINT.rstrip("/")


def get_openai_client() -> openai.OpenAI:
    """
    Return a synchronous OpenAI client.
    Prefers Azure OpenAI when AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_KEYS are set.
    """
    if settings.USE_AZURE_OPENAI:
        logger.info("Using Azure OpenAI (sync)", endpoint=_get_azure_base_url(),
                    deployment=settings.AZURE_OPENAI_DEPLOYMENT_NAME)
        return openai.AzureOpenAI(
            api_key=settings.AZURE_OPENAI_API_KEYS,
            azure_endpoint=_get_azure_base_url(),
            api_version=settings.AZURE_OPENAI_API_VERSION,
        )
    else:
        logger.info("Using standard OpenAI (sync)")
        return openai.OpenAI(api_key=settings.OPENAI_API_KEY)


def get_async_openai_client() -> openai.AsyncOpenAI:
    """
    Return an asynchronous OpenAI client.
    Prefers Azure OpenAI when AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_KEYS are set.
    """
    if settings.USE_AZURE_OPENAI:
        logger.info("Using Azure OpenAI (async)", endpoint=_get_azure_base_url(),
                    deployment=settings.AZURE_OPENAI_DEPLOYMENT_NAME)
        return openai.AsyncAzureOpenAI(
            api_key=settings.AZURE_OPENAI_API_KEYS,
            azure_endpoint=_get_azure_base_url(),
            api_version=settings.AZURE_OPENAI_API_VERSION,
        )
    else:
        logger.info("Using standard OpenAI (async)")
        return openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)


# The model/deployment name to use in all chat.completions.create() calls.
# When using Azure OpenAI, this MUST match the deployment name in Azure.
DEPLOYMENT_MODEL: str = (
    settings.AZURE_OPENAI_DEPLOYMENT_NAME
    if settings.USE_AZURE_OPENAI
    else settings.SUMMARY_MODEL
)
