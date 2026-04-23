from app.services.vector_store import vector_store_service


def test_delete_vectors_requires_full_scope(monkeypatch):
    delete_calls = []

    class _Index:
        def delete(self, **kwargs):
            delete_calls.append(kwargs)
            return {"ok": True}

    monkeypatch.setattr(vector_store_service, "get_index", lambda index_name, host="": _Index())

    try:
        vector_store_service.delete_vectors(
            index_name="idx",
            namespace="shared-file.pdf",
            host="",
            document_id="",
            workspace_id="ws-1",
            domain_id="d-1",
        )
        assert False, "Expected ValueError when document_id is missing"
    except ValueError:
        pass

    assert delete_calls == []


def test_delete_vectors_uses_document_workspace_domain_filter(monkeypatch):
    delete_calls = []

    class _Index:
        def delete(self, **kwargs):
            delete_calls.append(kwargs)
            return {"ok": True}

    monkeypatch.setattr(vector_store_service, "get_index", lambda index_name, host="": _Index())
    vector_store_service.delete_vectors(
        index_name="idx",
        namespace="shared-file.pdf",
        host="",
        document_id="doc-1",
        workspace_id="ws-1",
        domain_id="d-1",
    )

    assert len(delete_calls) == 1
    assert delete_calls[0]["filter"] == {
        "documentId": "doc-1",
        "workspaceId": "ws-1",
        "domainId": "d-1",
    }
