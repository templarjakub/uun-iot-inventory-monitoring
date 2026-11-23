"""Minimal pure-Python asyncio MQTT 3.1.1 broker for local BIOT demos and tests.

Supports CONNECT (with LWT), PUBLISH (QoS 0/1, retain), PUBACK, SUBSCRIBE/UNSUBSCRIBE
(with '+' and '#' wildcards), PINGREQ/PINGRESP, and graceful DISCONNECT.
For production deployments, use Eclipse Mosquitto (see iot/docker-compose.yml).
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import struct
import threading
from dataclasses import dataclass, field

logger = logging.getLogger("biot.broker")


def encode_remaining_length(length: int) -> bytes:
    out = bytearray()
    while True:
        digit = length % 128
        length //= 128
        if length > 0:
            digit |= 0x80
        out.append(digit)
        if length == 0:
            break
    return bytes(out)


async def read_remaining_length(reader: asyncio.StreamReader) -> int:
    multiplier = 1
    value = 0
    for _ in range(4):
        raw = await reader.readexactly(1)
        encoded = raw[0]
        value += (encoded & 0x7F) * multiplier
        if (encoded & 0x80) == 0:
            return value
        multiplier *= 128
    raise ValueError("Malformed MQTT remaining length")


def read_utf8(buf: memoryview, offset: int) -> tuple[str, int]:
    (length,) = struct.unpack_from("!H", buf, offset)
    offset += 2
    text = bytes(buf[offset : offset + length]).decode("utf-8")
    return text, offset + length


def read_bytes(buf: memoryview, offset: int) -> tuple[bytes, int]:
    (length,) = struct.unpack_from("!H", buf, offset)
    offset += 2
    data = bytes(buf[offset : offset + length])
    return data, offset + length


def topic_matches(topic_filter: str, topic_name: str) -> bool:
    if topic_name.startswith("$") and (topic_filter.startswith("+") or topic_filter.startswith("#")):
        return False

    filter_parts = topic_filter.split("/")
    topic_parts = topic_name.split("/")

    for idx, f_part in enumerate(filter_parts):
        if f_part == "#":
            return True
        if idx >= len(topic_parts):
            return False
        if f_part != "+" and f_part != topic_parts[idx]:
            return False

    return len(filter_parts) == len(topic_parts)


@dataclass
class _ClientSession:
    client_id: str
    writer: asyncio.StreamWriter
    subscriptions: dict[str, int] = field(default_factory=dict)
    will_topic: str | None = None
    will_payload: bytes = b""
    will_qos: int = 0
    will_retain: bool = False
    clean_disconnect: bool = False
    next_packet_id: int = 1

    def allocate_packet_id(self) -> int:
        pid = self.next_packet_id
        self.next_packet_id = (pid % 65535) + 1
        return pid


class LocalMQTTBroker:
    """Lightweight asyncio MQTT 3.1.1 broker."""

    def __init__(self, host: str = "127.0.0.1", port: int = 1883) -> None:
        self.host = host
        self.port = port
        self._server: asyncio.AbstractServer | None = None
        self._clients: dict[str, _ClientSession] = {}
        self._retained: dict[str, tuple[bytes, int]] = {}

    async def start(self) -> None:
        self._server = await asyncio.start_server(self._handle_client, self.host, self.port)
        sockets = self._server.sockets
        if sockets:
            self.port = int(sockets[0].getsockname()[1])
        logger.info("Local MQTT broker listening on %s:%d", self.host, self.port)

    async def stop(self) -> None:
        for session in list(self._clients.values()):
            try:
                session.writer.close()
            except Exception:
                pass
        self._clients.clear()
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        logger.info("Local MQTT broker stopped")

    async def _handle_client(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        session: _ClientSession | None = None
        try:
            while True:
                header = await reader.readexactly(1)
                packet_type = (header[0] >> 4) & 0x0F
                flags = header[0] & 0x0F
                remaining = await read_remaining_length(reader)
                body = await reader.readexactly(remaining) if remaining > 0 else b""
                view = memoryview(body)

                if packet_type == 1:  # CONNECT
                    session = await self._on_connect(view, writer)
                elif session is None:
                    break
                elif packet_type == 3:  # PUBLISH
                    await self._on_publish(session, flags, view)
                elif packet_type == 4:  # PUBACK
                    continue
                elif packet_type == 8:  # SUBSCRIBE
                    await self._on_subscribe(session, view)
                elif packet_type == 10:  # UNSUBSCRIBE
                    await self._on_unsubscribe(session, view)
                elif packet_type == 12:  # PINGREQ
                    writer.write(b"\xd0\x00")
                    await writer.drain()
                elif packet_type == 14:  # DISCONNECT
                    session.clean_disconnect = True
                    break
        except (asyncio.IncompleteReadError, ConnectionError, OSError):
            pass
        except Exception as exc:  # pragma: no cover
            logger.debug("Broker client handler error: %s", exc)
        finally:
            if session is not None:
                if self._clients.get(session.client_id) is session:
                    del self._clients[session.client_id]
                if not session.clean_disconnect and session.will_topic:
                    await self._publish_message(
                        session.will_topic,
                        session.will_payload,
                        session.will_qos,
                        session.will_retain,
                    )
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass

    async def _on_connect(
        self, view: memoryview, writer: asyncio.StreamWriter
    ) -> _ClientSession:
        _, offset = read_utf8(view, 0)
        connect_flags = view[offset + 1]
        offset += 4

        will_flag = bool(connect_flags & 0x04)
        will_qos = (connect_flags >> 3) & 0x03
        will_retain = bool(connect_flags & 0x20)
        username_flag = bool(connect_flags & 0x80)
        password_flag = bool(connect_flags & 0x40)

        client_id, offset = read_utf8(view, offset)
        if not client_id:
            client_id = f"anon-{id(writer)}"

        will_topic: str | None = None
        will_payload = b""
        if will_flag:
            will_topic, offset = read_utf8(view, offset)
            will_payload, offset = read_bytes(view, offset)
        if username_flag:
            _, offset = read_utf8(view, offset)
        if password_flag:
            _, offset = read_bytes(view, offset)

        old = self._clients.get(client_id)
        if old is not None:
            old.clean_disconnect = True
            old.writer.close()

        session = _ClientSession(
            client_id=client_id,
            writer=writer,
            will_topic=will_topic,
            will_payload=will_payload,
            will_qos=min(will_qos, 1),
            will_retain=will_retain,
        )
        self._clients[client_id] = session
        writer.write(b"\x20\x02\x00\x00")
        await writer.drain()
        return session

    async def _on_publish(self, session: _ClientSession, flags: int, view: memoryview) -> None:
        qos = (flags >> 1) & 0x03
        retain = bool(flags & 0x01)
        topic, offset = read_utf8(view, 0)
        packet_id = 0
        if qos > 0:
            (packet_id,) = struct.unpack_from("!H", view, offset)
            offset += 2
        payload = bytes(view[offset:])

        if qos == 1:
            session.writer.write(struct.pack("!BBH", 0x40, 2, packet_id))
            await session.writer.drain()

        await self._publish_message(topic, payload, min(qos, 1), retain)

    async def _publish_message(self, topic: str, payload: bytes, qos: int, retain: bool) -> None:
        if retain:
            if payload:
                self._retained[topic] = (payload, qos)
            else:
                self._retained.pop(topic, None)

        for subscriber in list(self._clients.values()):
            matched_qos: int | None = None
            for topic_filter, sub_qos in subscriber.subscriptions.items():
                if topic_matches(topic_filter, topic):
                    granted = min(qos, sub_qos, 1)
                    matched_qos = granted if matched_qos is None else max(matched_qos, granted)
            if matched_qos is not None:
                await self._send_publish(subscriber, topic, payload, matched_qos, retain=False)

    async def _send_publish(
        self,
        session: _ClientSession,
        topic: str,
        payload: bytes,
        qos: int,
        retain: bool,
    ) -> None:
        topic_bytes = topic.encode("utf-8")
        var_header = struct.pack("!H", len(topic_bytes)) + topic_bytes
        if qos == 1:
            var_header += struct.pack("!H", session.allocate_packet_id())

        header_byte = 0x30 | ((qos & 0x03) << 1) | (1 if retain else 0)
        body = var_header + payload
        packet = bytes([header_byte]) + encode_remaining_length(len(body)) + body
        try:
            session.writer.write(packet)
            await session.writer.drain()
        except (ConnectionError, OSError):
            pass

    async def _on_subscribe(self, session: _ClientSession, view: memoryview) -> None:
        (packet_id,) = struct.unpack_from("!H", view, 0)
        offset = 2
        granted: list[int] = []
        new_filters: list[tuple[str, int]] = []

        while offset < len(view):
            topic_filter, offset = read_utf8(view, offset)
            req_qos = min(int(view[offset]), 1)
            offset += 1
            session.subscriptions[topic_filter] = req_qos
            granted.append(req_qos)
            new_filters.append((topic_filter, req_qos))

        suback_body = struct.pack("!H", packet_id) + bytes(granted)
        session.writer.write(b"\x90" + encode_remaining_length(len(suback_body)) + suback_body)
        await session.writer.drain()

        for topic_filter, sub_qos in new_filters:
            for ret_topic, (ret_payload, ret_qos) in list(self._retained.items()):
                if topic_matches(topic_filter, ret_topic):
                    await self._send_publish(
                        session, ret_topic, ret_payload, min(ret_qos, sub_qos, 1), retain=True
                    )

    async def _on_unsubscribe(self, session: _ClientSession, view: memoryview) -> None:
        (packet_id,) = struct.unpack_from("!H", view, 0)
        offset = 2
        while offset < len(view):
            topic_filter, offset = read_utf8(view, offset)
            session.subscriptions.pop(topic_filter, None)

        session.writer.write(struct.pack("!BBH", 0xB0, 2, packet_id))
        await session.writer.drain()


class ThreadedMQTTBroker:
    """Runs LocalMQTTBroker in a background daemon thread."""

    def __init__(self, host: str = "127.0.0.1", port: int = 1883) -> None:
        self._broker = LocalMQTTBroker(host=host, port=port)
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._ready = threading.Event()
        self._error: BaseException | None = None

    @property
    def host(self) -> str:
        return self._broker.host

    @property
    def port(self) -> int:
        return self._broker.port

    def start(self, timeout_s: float = 5.0) -> None:
        self._ready.clear()
        self._error = None
        self._thread = threading.Thread(target=self._run, name="biot-mqtt-broker", daemon=True)
        self._thread.start()
        if not self._ready.wait(timeout=timeout_s):
            raise TimeoutError("Timed out starting local MQTT broker")
        if self._error is not None:
            raise self._error

    def _run(self) -> None:
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._broker.start())
        except BaseException as exc:
            self._error = exc
            self._ready.set()
            return
        self._ready.set()
        try:
            self._loop.run_forever()
        finally:
            self._loop.run_until_complete(self._broker.stop())
            self._loop.close()

    def stop(self) -> None:
        if self._loop is not None and self._loop.is_running():
            self._loop.call_soon_threadsafe(self._loop.stop)
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=3.0)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s [%(name)s] %(message)s",
    )
    parser = argparse.ArgumentParser(description="Run local MQTT 3.1.1 broker for BIOT.")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host")
    parser.add_argument("--port", type=int, default=1883, help="Bind port")
    args = parser.parse_args()

    broker = ThreadedMQTTBroker(host=args.host, port=args.port)
    broker.start()
    try:
        while True:
            threading.Event().wait(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        broker.stop()


if __name__ == "__main__":
    main()
