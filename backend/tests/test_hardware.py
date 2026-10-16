import pytest
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_hardware_status_endpoint():
    response = client.get("/hardware/status?port=COM6")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "port" in data
    assert data["port"] == "COM6"


def test_hardware_analyze_endpoint():
    response = client.post("/hardware/analyze", json={"code": "int a = 1;", "port": "COM6"})
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
