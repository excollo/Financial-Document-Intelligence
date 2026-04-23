import ssl

import pytest

from app.workers.redis_tls import build_rediss_ssl_options


def test_rediss_requires_ca_bundle_in_production():
    with pytest.raises(ValueError, match="REDIS_TLS_CA_BUNDLE is required"):
        build_rediss_ssl_options(
            url="rediss://example:6379/0",
            is_production=True,
            ca_bundle_path=None,
        )


def test_rediss_requires_existing_ca_bundle_path_in_production():
    with pytest.raises(ValueError, match="path does not exist"):
        build_rediss_ssl_options(
            url="rediss://example:6379/0",
            is_production=True,
            ca_bundle_path="/tmp/does-not-exist-ca.pem",
        )


def test_rediss_uses_cert_required_with_ca_bundle_in_production(tmp_path):
    ca_bundle = tmp_path / "ca.pem"
    ca_bundle.write_text("dummy-ca")

    options = build_rediss_ssl_options(
        url="rediss://example:6379/0",
        is_production=True,
        ca_bundle_path=str(ca_bundle),
    )

    assert options == {
        "ssl_cert_reqs": ssl.CERT_REQUIRED,
        "ssl_ca_certs": str(ca_bundle),
    }
