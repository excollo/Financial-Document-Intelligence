import os
import ssl
from typing import Optional


def build_rediss_ssl_options(
    *,
    url: Optional[str],
    is_production: bool,
    ca_bundle_path: Optional[str],
) -> Optional[dict]:
    if not url or not url.startswith("rediss://"):
        return None
    if is_production:
        ca_bundle = (ca_bundle_path or "").strip()
        if not ca_bundle:
            raise ValueError(
                "REDIS_TLS_CA_BUNDLE is required in production when using rediss://"
            )
        if not os.path.exists(ca_bundle):
            raise ValueError(
                f"REDIS_TLS_CA_BUNDLE path does not exist: {ca_bundle}"
            )
        return {
            "ssl_cert_reqs": ssl.CERT_REQUIRED,
            "ssl_ca_certs": ca_bundle,
        }
    return {"ssl_cert_reqs": ssl.CERT_NONE}
