"""Coordinator and calculation engine for Curve Controller."""
from __future__ import annotations

import logging
import time
import copy
from datetime import timedelta
from typing import Any, Callable

from homeassistant.core import HomeAssistant, State
from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.storage import Store
from homeassistant.helpers.event import (
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.exceptions import HomeAssistantError

from .const import (
    DOMAIN,
    STORAGE_VERSION,
    STORAGE_KEY_PREFIX,
    CONF_SOURCE_ENTITY,
    CONF_TARGET_ENTITY,
    CONF_EVAL_MODE,
    CONF_UPDATE_INTERVAL,
    CONF_ROUND_DECIMALS,
    EVAL_MODE_STATE_CHANGE,
    DEFAULT_CURVES,
    DEFAULT_ROUND_DECIMALS,
)

_LOGGER = logging.getLogger(__name__)


def interpolate_curve(
    points: list[list[float]], x_value: float, round_decimals: int = 1
) -> float | None:
    """Calculate the target value using piecewise linear interpolation with clamping.

    - Clamping: values outside [min_x, max_x] are clamped to the edge Y values.
    - Flat plateaus: horizontal segments where Y1 == Y2 are properly respected.
    """
    if not points:
        return None

    try:
        decimals = int(round_decimals)
    except (ValueError, TypeError):
        decimals = 1

    # Ensure points are sorted by X ascending
    sorted_points = sorted([[float(p[0]), float(p[1])] for p in points], key=lambda p: p[0])

    if len(sorted_points) == 1:
        return round(sorted_points[0][1], decimals)

    # Clamping left
    first_x, first_y = sorted_points[0]
    if x_value <= first_x:
        return round(first_y, decimals)

    # Clamping right
    last_x, last_y = sorted_points[-1]
    if x_value >= last_x:
        return round(last_y, decimals)

    # Find the matching interval [x_i, x_{i+1}]
    for i in range(len(sorted_points) - 1):
        x1, y1 = sorted_points[i]
        x2, y2 = sorted_points[i + 1]

        if x1 <= x_value <= x2:
            if x2 == x1:
                return round(y1, decimals)
            # Linear interpolation
            slope = (y2 - y1) / (x2 - x1)
            y = y1 + (x_value - x1) * slope
            return round(y, decimals)

    return round(last_y, decimals)


class CurveControllerCoordinator:
    """Manages curves, interpolation calculations, and updates target entities."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the coordinator."""
        self.hass = hass
        self.entry = entry
        self.entry_id = entry.entry_id
        self._store = Store(
            hass,
            STORAGE_VERSION,
            f"{STORAGE_KEY_PREFIX}.{self.entry_id}.json",
        )

        self.curves: dict[str, list[list[float]]] = {}
        self.active_curve: str = ""
        self.source_value: float | None = None
        self.calculated_value: float | None = None
        self.enabled: bool = True
        self.version: int = 1

        self._listeners: list[Callable[[], None]] = []
        self._unsub_tracker: Callable[[], None] | None = None

    @property
    def source_entity(self) -> str:
        """Get source entity id."""
        return self.entry.options.get(
            CONF_SOURCE_ENTITY, self.entry.data.get(CONF_SOURCE_ENTITY, "")
        )

    @property
    def target_entity(self) -> str:
        """Get target entity id."""
        return self.entry.options.get(
            CONF_TARGET_ENTITY, self.entry.data.get(CONF_TARGET_ENTITY, "")
        )

    @property
    def eval_mode(self) -> str:
        """Get evaluation trigger mode."""
        return self.entry.options.get(
            CONF_EVAL_MODE, self.entry.data.get(CONF_EVAL_MODE, EVAL_MODE_STATE_CHANGE)
        )

    @property
    def update_interval(self) -> int:
        """Get update interval in seconds."""
        raw = self.entry.options.get(
            CONF_UPDATE_INTERVAL, self.entry.data.get(CONF_UPDATE_INTERVAL, 300)
        )
        try:
            return int(raw)
        except (ValueError, TypeError):
            return 300

    @property
    def round_decimals(self) -> int:
        """Get rounding precision."""
        raw = self.entry.options.get(
            CONF_ROUND_DECIMALS,
            self.entry.data.get(CONF_ROUND_DECIMALS, DEFAULT_ROUND_DECIMALS),
        )
        try:
            return int(raw)
        except (ValueError, TypeError):
            return DEFAULT_ROUND_DECIMALS

    @property
    def source_unit(self) -> str:
        """Get unit of measurement of source entity."""
        if not self.source_entity:
            return ""
        state = self.hass.states.get(self.source_entity)
        return state.attributes.get("unit_of_measurement", "") if state else ""

    @property
    def target_unit(self) -> str:
        """Get unit of measurement of target entity."""
        if not self.target_entity:
            return ""
        state = self.hass.states.get(self.target_entity)
        if state:
            unit = state.attributes.get("unit_of_measurement")
            if unit:
                return unit
            domain = self.target_entity.split(".")[0]
            if domain == "climate":
                return state.attributes.get("temperature_unit") or self.hass.config.units.temperature_unit
            if domain == "fan" or domain == "cover":
                return "%"
        return ""

    async def async_setup(self) -> None:
        """Load stored curves and setup listeners."""
        # Load from storage
        stored_data = await self._store.async_load()
        if stored_data and isinstance(stored_data, dict):
            self.curves = stored_data.get("curves", DEFAULT_CURVES.copy())
            self.active_curve = stored_data.get("active_curve", "")
            self.enabled = stored_data.get("enabled", True)
        else:
            self.curves = {k: [list(pt) for pt in v] for k, v in DEFAULT_CURVES.items()}
            self.active_curve = next(iter(self.curves.keys()), "Hiver")
            self.enabled = True
            await self._async_save_to_storage()

        if self.active_curve not in self.curves and self.curves:
            self.active_curve = next(iter(self.curves.keys()))

        # Register trigger / evaluation tracker
        self._setup_evaluation_trigger()

        # Initial evaluation
        await self.async_evaluate()

    def _setup_evaluation_trigger(self) -> None:
        """Set up state change listener or interval timer."""
        if self._unsub_tracker:
            self._unsub_tracker()
            self._unsub_tracker = None

        if self.eval_mode == EVAL_MODE_STATE_CHANGE and self.source_entity:
            _LOGGER.debug(
                "Tracking state changes for source entity %s", self.source_entity
            )

            async def _state_changed(event: Any) -> None:
                new_state: State | None = event.data.get("new_state")
                if new_state is not None and new_state.state not in (
                    "unknown",
                    "unavailable",
                ):
                    await self.async_evaluate()

            self._unsub_tracker = async_track_state_change_event(
                self.hass, [self.source_entity], _state_changed
            )
        else:
            interval_sec = max(5, self.update_interval)
            _LOGGER.debug(
                "Tracking periodic interval (%ds) for %s",
                interval_sec,
                self.entry.title,
            )

            async def _interval_fired(_now: Any) -> None:
                await self.async_evaluate()

            self._unsub_tracker = async_track_time_interval(
                self.hass, _interval_fired, timedelta(seconds=interval_sec)
            )

    async def async_unload(self) -> None:
        """Unload listeners and cleanup."""
        if self._unsub_tracker:
            self._unsub_tracker()
            self._unsub_tracker = None
        self._listeners.clear()

    def add_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        """Add a callback listener for entity updates."""
        self._listeners.append(listener)

        def _remove() -> None:
            if listener in self._listeners:
                self._listeners.remove(listener)

        return _remove

    def notify_listeners(self) -> None:
        """Notify entities and frontend that state has updated."""
        for listener in self._listeners:
            try:
                listener()
            except Exception as err:
                _LOGGER.exception("Error notifying listener: %s", err)

    async def _async_save_to_storage(self) -> None:
        """Persist current curves and active selection."""
        data = {
            "active_curve": self.active_curve,
            "curves": self.curves,
            "enabled": self.enabled,
        }
        await self._store.async_save(data)

    async def async_set_enabled(self, enabled: bool) -> None:
        """Enable or disable regulation output injection."""
        self.enabled = bool(enabled)
        self.version += 1
        await self._async_save_to_storage()
        if self.enabled:
            await self.async_evaluate()
        else:
            self.notify_listeners()
        _LOGGER.info(
            "Regulation %s for %s",
            "enabled" if self.enabled else "disabled",
            self.entry.title,
        )

    async def async_select_curve(self, curve_name: str) -> None:
        """Switch the active curve and recalculate."""
        if curve_name not in self.curves:
            raise HomeAssistantError(f"Curve '{curve_name}' does not exist.")

        self.active_curve = curve_name
        self.version += 1
        await self._async_save_to_storage()
        await self.async_evaluate()
        self.notify_listeners()
        _LOGGER.info("Curve '%s' is now active for %s", curve_name, self.entry.title)

    async def async_save_curve(
        self,
        curve_name: str,
        points: list[Any],
        set_active: bool = False,
    ) -> None:
        """Create or update a curve and optionally make it active."""
        cleaned_points: list[list[float]] = []
        for pt in points:
            if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                cleaned_points.append([float(pt[0]), float(pt[1])])
            elif isinstance(pt, dict) and "x" in pt and "y" in pt:
                cleaned_points.append([float(pt["x"]), float(pt["y"])])

        # Sort points by X
        cleaned_points.sort(key=lambda p: p[0])

        new_curves = {k: [list(p) for p in v] for k, v in self.curves.items()}
        new_curves[curve_name] = cleaned_points
        self.curves = new_curves
        self.version += 1

        if set_active or not self.active_curve or self.active_curve not in self.curves:
            self.active_curve = curve_name

        await self._async_save_to_storage()
        await self.async_evaluate()
        self.notify_listeners()
        _LOGGER.info(
            "Saved curve '%s' with %d points for %s (v%d)",
            curve_name,
            len(cleaned_points),
            self.entry.title,
            self.version,
        )

    async def async_delete_curve(self, curve_name: str) -> None:
        """Delete an existing curve."""
        if curve_name not in self.curves:
            raise HomeAssistantError(f"Curve '{curve_name}' not found.")

        if len(self.curves) <= 1:
            raise HomeAssistantError("Cannot delete the only remaining curve.")

        new_curves = {k: [list(p) for p in v] for k, v in self.curves.items() if k != curve_name}
        self.curves = new_curves
        self.version += 1

        if self.active_curve == curve_name:
            self.active_curve = next(iter(self.curves.keys()))

        await self._async_save_to_storage()
        await self.async_evaluate()
        self.notify_listeners()
        _LOGGER.info("Deleted curve '%s' from %s (v%d)", curve_name, self.entry.title, self.version)

    async def async_evaluate(self) -> None:
        """Read source entity, interpolate according to active curve, and set target."""
        if not self.source_entity:
            _LOGGER.warning("No source entity configured for %s", self.entry.title)
            return

        source_state = self.hass.states.get(self.source_entity)
        if (
            source_state is None
            or source_state.state in ("unknown", "unavailable", None)
        ):
            _LOGGER.debug(
                "Source entity %s is not available (state: %s)",
                self.source_entity,
                getattr(source_state, "state", "None"),
            )
            return

        try:
            self.source_value = float(source_state.state)
        except (ValueError, TypeError):
            _LOGGER.warning(
                "Source entity %s state '%s' cannot be converted to float",
                self.source_entity,
                source_state.state,
            )
            return

        points = self.curves.get(self.active_curve, [])
        if not points:
            _LOGGER.warning(
                "Active curve '%s' has no points configured", self.active_curve
            )
            self.calculated_value = None
            self.notify_listeners()
            return

        # Linear interpolation with clamping
        result = interpolate_curve(points, self.source_value, self.round_decimals)
        self.calculated_value = result

        # Dispatch output to target entity if configured and regulation is enabled
        if self.enabled and self.calculated_value is not None and self.target_entity:
            await self._async_update_target_entity(self.calculated_value)
        elif not self.enabled:
            _LOGGER.debug(
                "Regulation paused for %s; not writing to target entity %s (calculated: %s)",
                self.entry.title,
                self.target_entity,
                self.calculated_value,
            )

        self.notify_listeners()

    async def _async_update_target_entity(self, value: float) -> None:
        """Send computed setpoint value to the target entity."""
        target_entity_id = self.target_entity
        target_state = self.hass.states.get(target_entity_id)

        if not target_state:
            _LOGGER.warning(
                "Target entity %s not found in Home Assistant states",
                target_entity_id,
            )
            return

        domain = target_entity_id.split(".")[0]

        try:
            if domain == "input_number":
                await self.hass.services.async_call(
                    "input_number",
                    "set_value",
                    {"entity_id": target_entity_id, "value": value},
                    blocking=False,
                )
            elif domain == "number":
                await self.hass.services.async_call(
                    "number",
                    "set_value",
                    {"entity_id": target_entity_id, "value": value},
                    blocking=False,
                )
            elif domain == "climate":
                await self.hass.services.async_call(
                    "climate",
                    "set_temperature",
                    {"entity_id": target_entity_id, "temperature": value},
                    blocking=False,
                )
            elif domain == "fan":
                # Percentage 0-100
                pct = max(0, min(100, int(round(value))))
                await self.hass.services.async_call(
                    "fan",
                    "set_percentage",
                    {"entity_id": target_entity_id, "percentage": pct},
                    blocking=False,
                )
            elif domain == "cover":
                pos = max(0, min(100, int(round(value))))
                await self.hass.services.async_call(
                    "cover",
                    "set_cover_position",
                    {"entity_id": target_entity_id, "position": pos},
                    blocking=False,
                )
            elif domain == "light":
                pct = max(0, min(100, int(round(value))))
                await self.hass.services.async_call(
                    "light",
                    "turn_on",
                    {"entity_id": target_entity_id, "brightness_pct": pct},
                    blocking=False,
                )
            else:
                _LOGGER.debug(
                    "No default service handler for domain '%s' on %s; value: %s",
                    domain,
                    target_entity_id,
                    value,
                )
        except Exception as err:
            _LOGGER.error(
                "Failed to update target entity %s with value %s: %s",
                target_entity_id,
                value,
                err,
            )

