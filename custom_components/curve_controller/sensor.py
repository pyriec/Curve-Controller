"""Sensor platform for Curve Controller."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.sensor import (
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    DOMAIN,
    ATTR_ACTIVE_CURVE,
    ATTR_CURVES,
    ATTR_ENTRY_ID,
    ATTR_SOURCE_ENTITY,
    ATTR_SOURCE_VALUE,
    ATTR_TARGET_ENTITY,
    ATTR_CALCULATED_VALUE,
    ATTR_POINTS_LIST,
    ATTR_REGULATION_ENABLED,
    ATTR_SOURCE_UNIT,
    ATTR_TARGET_UNIT,
)
from .coordinator import CurveControllerCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the Curve Controller sensor platform."""
    coordinator: CurveControllerCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([CurveControllerOutputSensor(coordinator, entry)])


class CurveControllerOutputSensor(SensorEntity):
    """Sensor reflecting the currently calculated setpoint value."""

    _attr_has_entity_name = True
    _attr_icon = "mdi:chart-timeline-variant"
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(
        self,
        coordinator: CurveControllerCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the sensor entity."""
        self.coordinator = coordinator
        self.entry = entry
        self._attr_name = "Calculated Output"
        self._attr_unique_id = f"{entry.entry_id}_calculated_output"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": entry.title,
            "manufacturer": "Curve Controller",
            "model": "Piecewise Linear Controller",
        }

    @property
    def native_value(self) -> float | None:
        """Return the calculated target value."""
        return self.coordinator.calculated_value

    @property
    def native_unit_of_measurement(self) -> str | None:
        """Return the unit of measurement."""
        return self.coordinator.target_unit or None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return extra state attributes for Lovelace card and automations."""
        active_points = [
            list(pt)
            for pt in self.coordinator.curves.get(self.coordinator.active_curve, [])
        ]
        return {
            ATTR_ENTRY_ID: self.coordinator.entry_id,
            ATTR_ACTIVE_CURVE: self.coordinator.active_curve,
            ATTR_SOURCE_ENTITY: self.coordinator.source_entity,
            ATTR_SOURCE_VALUE: self.coordinator.source_value,
            ATTR_SOURCE_UNIT: self.coordinator.source_unit,
            ATTR_TARGET_ENTITY: self.coordinator.target_entity,
            ATTR_TARGET_UNIT: self.coordinator.target_unit,
            ATTR_CALCULATED_VALUE: self.coordinator.calculated_value,
            ATTR_POINTS_LIST: active_points,
            ATTR_CURVES: {
                k: [list(pt) for pt in v] for k, v in self.coordinator.curves.items()
            },
            ATTR_REGULATION_ENABLED: self.coordinator.enabled,
            "curves_version": self.coordinator.version,
        }

    async def async_added_to_hass(self) -> None:
        """Register coordinator update listener."""
        self.async_on_remove(
            self.coordinator.add_listener(self._handle_coordinator_update)
        )

    @callback
    def _handle_coordinator_update(self) -> None:
        """Handle updated data from coordinator."""
        self.async_write_ha_state()

