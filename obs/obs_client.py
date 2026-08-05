"""OBS WebSocket client wrapper using obsws-python."""

from __future__ import annotations

from typing import Any

import obsws_python as obs

from models.source_item import SourceItem, TransformSnapshot

# Source kinds eligible for grid placement.
SUPPORTED_INPUT_KINDS: frozenset[str] = frozenset(
    {
        "image_source",
        "ffmpeg_source",
        "slideshow",
        "browser_source",
    }
)

BOUNDS_SCALE_INNER = "OBS_BOUNDS_SCALE_INNER"


class ObsClientError(Exception):
    """Raised when an OBS WebSocket operation fails."""


class ObsClient:
    """Thin wrapper around ``obsws_python.ReqClient`` for grid layout use."""

    def __init__(self) -> None:
        self._client: obs.ReqClient | None = None
        self._host: str = "localhost"
        self._port: int = 4455

    @property
    def is_connected(self) -> bool:
        """Return whether a request client is currently available."""
        return self._client is not None

    def connect(self, host: str = "localhost", port: int = 4455, password: str = "") -> None:
        """Connect to the OBS WebSocket server.

        Raises:
            ObsClientError: If the connection cannot be established.
        """
        self.disconnect()
        try:
            kwargs: dict[str, Any] = {"host": host, "port": port, "timeout": 5}
            if password:
                kwargs["password"] = password
            self._client = obs.ReqClient(**kwargs)
            # Probe connectivity with a lightweight request.
            self._client.get_version()
            self._host = host
            self._port = port
        except Exception as exc:  # noqa: BLE001 - surface any WS/auth failure
            self._client = None
            raise ObsClientError(f"OBS 연결 실패 ({host}:{port}): {exc}") from exc

    def disconnect(self) -> None:
        """Close the WebSocket connection if open."""
        if self._client is None:
            return
        try:
            self._client.base_client.ws.close()
        except Exception:  # noqa: BLE001 - best-effort close
            pass
        finally:
            self._client = None

    def _require_client(self) -> obs.ReqClient:
        if self._client is None:
            raise ObsClientError("OBS에 연결되어 있지 않습니다.")
        return self._client

    def get_current_program_scene(self) -> str:
        """Return the current program scene name."""
        client = self._require_client()
        try:
            resp = client.get_current_program_scene()
            return str(resp.current_program_scene_name)
        except Exception as exc:  # noqa: BLE001
            raise ObsClientError(f"현재 장면을 가져오지 못했습니다: {exc}") from exc

    def get_video_canvas_size(self) -> tuple[int, int]:
        """Return OBS base (canvas) width and height."""
        client = self._require_client()
        try:
            resp = client.get_video_settings()
            return int(resp.base_width), int(resp.base_height)
        except Exception as exc:  # noqa: BLE001
            raise ObsClientError(f"캔버스 크기를 가져오지 못했습니다: {exc}") from exc

    def get_layout_sources(self, scene_name: str | None = None) -> tuple[str, list[SourceItem]]:
        """Load the current (or given) scene and return eligible sources.

        Sources are sorted by name (ascending).
        """
        client = self._require_client()
        try:
            if not scene_name:
                scene_name = self.get_current_program_scene()

            resp = client.get_scene_item_list(scene_name)
            items = list(getattr(resp, "scene_items", []) or [])

            sources: list[SourceItem] = []
            for item in items:
                if isinstance(item, dict):
                    source_name = str(item.get("sourceName") or item.get("source_name") or "")
                    scene_item_id = int(item.get("sceneItemId") or item.get("scene_item_id") or 0)
                    input_kind = str(
                        item.get("inputKind")
                        or item.get("input_kind")
                        or item.get("source_type")
                        or ""
                    )
                else:
                    source_name = str(getattr(item, "source_name", ""))
                    scene_item_id = int(getattr(item, "scene_item_id", 0))
                    input_kind = str(
                        getattr(item, "input_kind", None)
                        or getattr(item, "source_type", "")
                        or ""
                    )

                if not source_name:
                    continue

                # Scene item list may omit inputKind; resolve via GetInputSettings / GetInputKind.
                if not input_kind or input_kind not in SUPPORTED_INPUT_KINDS:
                    input_kind = self._resolve_input_kind(source_name)

                if input_kind not in SUPPORTED_INPUT_KINDS:
                    continue

                sources.append(
                    SourceItem(
                        scene_item_id=scene_item_id,
                        source_name=source_name,
                        input_kind=input_kind,
                        selected=True,
                    )
                )

            sources.sort(key=lambda s: s.source_name.lower())
            for index, source in enumerate(sources):
                source.index = index
            return scene_name, sources
        except ObsClientError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise ObsClientError(f"장면 소스를 불러오지 못했습니다: {exc}") from exc

    def _resolve_input_kind(self, source_name: str) -> str:
        """Best-effort lookup of an input's kind by name."""
        client = self._require_client()
        try:
            resp = client.get_input_settings(source_name)
            kind = getattr(resp, "input_kind", None)
            if kind:
                return str(kind)
        except Exception:  # noqa: BLE001
            pass

        # Fallback: scan all inputs.
        try:
            resp = client.get_input_list()
            for entry in getattr(resp, "inputs", []) or []:
                if isinstance(entry, dict):
                    name = entry.get("inputName") or entry.get("input_name")
                    kind = entry.get("inputKind") or entry.get("input_kind")
                else:
                    name = getattr(entry, "input_name", None)
                    kind = getattr(entry, "input_kind", None)
                if name == source_name and kind:
                    return str(kind)
        except Exception:  # noqa: BLE001
            pass
        return ""

    def get_scene_item_transform(self, scene_name: str, scene_item_id: int) -> dict[str, Any]:
        """Return the current transform dictionary for a scene item."""
        client = self._require_client()
        try:
            resp = client.get_scene_item_transform(scene_name, scene_item_id)
            transform = getattr(resp, "scene_item_transform", None)
            if isinstance(transform, dict):
                return dict(transform)
            # Convert response object attributes if needed.
            if transform is not None:
                return {
                    key: getattr(transform, key)
                    for key in dir(transform)
                    if not key.startswith("_") and not callable(getattr(transform, key))
                }
            return {}
        except Exception as exc:  # noqa: BLE001
            raise ObsClientError(
                f"Transform을 가져오지 못했습니다 (id={scene_item_id}): {exc}"
            ) from exc

    def capture_transforms(
        self,
        scene_name: str,
        sources: list[SourceItem],
    ) -> list[TransformSnapshot]:
        """Snapshot transforms for the given sources (used by Undo)."""
        snapshots: list[TransformSnapshot] = []
        for source in sources:
            transform = self.get_scene_item_transform(scene_name, source.scene_item_id)
            snapshots.append(
                TransformSnapshot(
                    scene_name=scene_name,
                    scene_item_id=source.scene_item_id,
                    source_name=source.source_name,
                    transform=transform,
                )
            )
        return snapshots

    def apply_grid_transforms(
        self,
        scene_name: str,
        placements: list[tuple[SourceItem, float, float, float, float]],
    ) -> None:
        """Apply position and bounds for each (source, x, y, w, h) placement."""
        client = self._require_client()
        errors: list[str] = []
        for source, x, y, width, height in placements:
            transform = {
                "positionX": float(x),
                "positionY": float(y),
                "boundsType": BOUNDS_SCALE_INNER,
                "boundsWidth": max(1.0, float(width)),
                "boundsHeight": max(1.0, float(height)),
            }
            try:
                client.set_scene_item_transform(scene_name, source.scene_item_id, transform)
            except Exception as exc:  # noqa: BLE001
                # Retry with snake_case keys used by some obsws-python versions.
                try:
                    client.set_scene_item_transform(
                        scene_name,
                        source.scene_item_id,
                        {
                            "position_x": float(x),
                            "position_y": float(y),
                            "bounds_type": BOUNDS_SCALE_INNER,
                            "bounds_width": max(1.0, float(width)),
                            "bounds_height": max(1.0, float(height)),
                        },
                    )
                except Exception as exc2:  # noqa: BLE001
                    errors.append(f"{source.source_name}: {exc2 or exc}")

        if errors:
            raise ObsClientError("일부 소스 배치에 실패했습니다:\n" + "\n".join(errors))

    def restore_transforms(self, snapshots: list[TransformSnapshot]) -> None:
        """Restore previously captured transforms (Undo)."""
        client = self._require_client()
        errors: list[str] = []
        for snap in snapshots:
            payload = self._normalize_restore_transform(snap.transform)
            try:
                client.set_scene_item_transform(snap.scene_name, snap.scene_item_id, payload)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{snap.source_name}: {exc}")
        if errors:
            raise ObsClientError("Undo 복원에 실패했습니다:\n" + "\n".join(errors))

    @staticmethod
    def _normalize_restore_transform(transform: dict[str, Any]) -> dict[str, Any]:
        """Keep only writable transform fields for SetSceneItemTransform."""
        writable = {
            "positionX",
            "positionY",
            "rotation",
            "scaleX",
            "scaleY",
            "alignment",
            "boundsType",
            "boundsAlignment",
            "boundsWidth",
            "boundsHeight",
            "cropLeft",
            "cropRight",
            "cropTop",
            "cropBottom",
            # snake_case variants
            "position_x",
            "position_y",
            "scale_x",
            "scale_y",
            "bounds_type",
            "bounds_alignment",
            "bounds_width",
            "bounds_height",
            "crop_left",
            "crop_right",
            "crop_top",
            "crop_bottom",
        }
        return {key: value for key, value in transform.items() if key in writable}
