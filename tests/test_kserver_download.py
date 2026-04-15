from __future__ import annotations

import base64
import json
import unittest

from tools import kserver


class KServerDownloadTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._orig_has_remote_runtime = kserver._has_remote_runtime
        self._orig_exec_code = kserver.exec_code
        self._orig_chunk_size = kserver.FS_DOWNLOAD_CHUNK_SIZE
        kserver._has_remote_runtime = lambda device_id=None: True
        kserver.FS_DOWNLOAD_CHUNK_SIZE = 4

    def tearDown(self) -> None:
        kserver._has_remote_runtime = self._orig_has_remote_runtime
        kserver.exec_code = self._orig_exec_code
        kserver.FS_DOWNLOAD_CHUNK_SIZE = self._orig_chunk_size

    async def test_fs_download_reassembles_binary_chunks(self) -> None:
        file_bytes = b"PK\x03\x04abcdefghi"
        read_offsets: list[int] = []

        async def fake_exec_code(code: str, timeout: float = kserver.EXEC_TIMEOUT, **_: object) -> dict:
            if "FileUtils.stat" in code:
                return {"value": json.dumps({"size": len(file_bytes), "isFile": True})}
            offset = len(read_offsets) * kserver.FS_DOWNLOAD_CHUNK_SIZE
            read_offsets.append(offset)
            chunk = file_bytes[offset:offset + kserver.FS_DOWNLOAD_CHUNK_SIZE]
            return {
                "encoding": "binary",
                "valueEncoding": "binary",
                "value": f"<binary {len(chunk)} bytes>",
                "binaryBase64": base64.b64encode(chunk).decode("ascii"),
            }

        kserver.exec_code = fake_exec_code

        status, body, content_type = await kserver._fs_download_handler(json.dumps({"path": "/tmp/app.ipa"}).encode())

        self.assertEqual(status, 200)
        self.assertEqual(body, file_bytes)
        self.assertIn("application/octet-stream", content_type)
        self.assertEqual(read_offsets, [0, 4, 8, 12])

    async def test_fs_download_fails_instead_of_returning_partial_file_on_chunk_error(self) -> None:
        file_bytes = b"abcdefgh"
        read_count = 0

        async def fake_exec_code(code: str, timeout: float = kserver.EXEC_TIMEOUT, **_: object) -> dict:
            nonlocal read_count
            if "FileUtils.stat" in code:
                return {"value": json.dumps({"size": len(file_bytes), "isFile": True})}
            read_count += 1
            if read_count == 1:
                chunk = file_bytes[:kserver.FS_DOWNLOAD_CHUNK_SIZE]
                return {"binaryBase64": base64.b64encode(chunk).decode("ascii")}
            return {
                "type": "error",
                "error": "executeRemoteScript: invalid bulk transfer descriptor",
                "logs": ["bridge failed"],
            }

        kserver.exec_code = fake_exec_code

        status, body, _ = await kserver._fs_download_handler(json.dumps({"path": "/tmp/app.ipa"}).encode())
        payload = json.loads(body.decode("utf-8"))

        self.assertEqual(status, 500)
        self.assertIn("offset 4", payload["error"])
        self.assertIn("invalid bulk transfer descriptor", payload["error"])
        self.assertEqual(payload["logs"], ["bridge failed"])


if __name__ == "__main__":
    unittest.main()
