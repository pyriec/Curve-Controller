"""Switch platform for Curve Controller regulation."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, ATTR_ENTRY_ID
from .coordinator import CurveControllerCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the Curve Controller switch platform."""
    coordinator: CurveControllerCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([CurveControllerRegulationSwitch(coordinator, entry)])


class CurveControllerRegulationSwitch(SwitchEntity):
    """Switch entity to enable or pause regulation injection."""

    _attr_has_entity_name = True
    _attr_icon = "mdi:play-pause"

    def __init__(
        self,
        coordinator: CurveControllerCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the switch entity."""
        self.coordinator = coordinator
        self.entry = entry
        self._attr_name = "Regulation"
        self._attr_unique_id = f"{entry.entry_id}_regulation"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": entry.title,
            "manufacturer": "Curve Controller",
            "model": "Piecewise Linear Controller",
        }

    @property
    def is_on(self) -> bool:
        """Return True if regulation is enabled."""
        return self.coordinator.enabled

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return extra state attributes."""
        return {
            ATTR_ENTRY_ID: self.coordinator.entry_id,
            "target_entity": self.coordinator.target_entity,
            "active_curve": self.coordinator.active_curve,
        }

    async def async_turn_on(self, **kwargs: Any) -> None:
        """Turn the regulation on."""
        await self.coordinator.async_set_enabled(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        """Turn the regulation off."""
        await self.coordinator.async_set_enabled(False)

    async def async_added_to_hass(self) -> None:
        """Register coordinator update listener."""
        self.async_on_remove(
            self.coordinator.add_listener(self._handle_coordinator_update)
        )

    @callback
    def _handle_coordinator_update(self) -> None:
        """Handle updated data from coordinator."""
        self.async_write_ha_state()

