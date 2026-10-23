"""Select platform for Curve Controller."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    DOMAIN,
    ATTR_ACTIVE_CURVE,
    ATTR_CURVES,
    ATTR_ENTRY_ID,
)
from .coordinator import CurveControllerCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the Curve Controller select platform."""
    coordinator: CurveControllerCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([CurveControllerSelectEntity(coordinator, entry)])


class CurveControllerSelectEntity(SelectEntity):
    """Representation of the active curve selector."""

    _attr_has_entity_name = True
    _attr_icon = "mdi:chart-bell-curve-cumulative"

    def __init__(
        self,
        coordinator: CurveControllerCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the select entity."""
        self.coordinator = coordinator
        self.entry = entry
        self._attr_name = "Active Curve"
        self._attr_unique_id = f"{entry.entry_id}_active_curve"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": entry.title,
            "manufacturer": "Curve Controller",
            "model": "Piecewise Linear Controller",
        }

    @property
    def current_option(self) -> str | None:
        """Return the current active curve name."""
        return self.coordinator.active_curve

    @property
    def options(self) -> list[str]:
        """Return the list of available curves."""
        return list(self.coordinator.curves.keys())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return extra state attributes."""
        return {
            ATTR_ENTRY_ID: self.coordinator.entry_id,
            ATTR_ACTIVE_CURVE: self.coordinator.active_curve,
            ATTR_CURVES: self.coordinator.curves,
        }

    async def async_select_option(self, option: str) -> None:
        """Change the active curve."""
        await self.coordinator.async_select_curve(option)

    async def async_added_to_hass(self) -> None:
        """Register coordinator update listener."""
        self.async_on_remove(
            self.coordinator.add_listener(self._handle_coordinator_update)
        )

    @callback
    def _handle_coordinator_update(self) -> None:
        """Handle updated data from coordinator."""
        self.async_write_ha_state()

