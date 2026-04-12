from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from backend.main import app


class ApiHealthTests(unittest.TestCase):
    def test_api_health_returns_ok(self) -> None:
        client = TestClient(app)
        response = client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})


if __name__ == "__main__":
    unittest.main()
