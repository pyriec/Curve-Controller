"""The Curve Controller integration."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers import entity_registry as er

from .const import (
    DOMAIN,
    PLATFORMS,
    URL_BASE,
    CARD_JS_NAME,
    SERVICE_SELECT_CURVE,
    SERVICE_SAVE_CURVE,
    SERVICE_DELETE_CURVE,
    SERVICE_EVALUATE,
    ATTR_CURVE_NAME,
    ATTR_POINTS,
    ATTR_SET_ACTIVE,
    ATTR_ENTRY_ID,
)
from .coordinator import CurveControllerCoordinator

_LOGGER = logging.getLogger(__name__)

SELECT_CURVE_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_ENTRY_ID): cv.string,
        vol.Optional("entity_id"): cv.entity_id,
        vol.Required(ATTR_CURVE_NAME): cv.string,
    }
)

SAVE_CURVE_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_ENTRY_ID): cv.string,
        vol.Optional("entity_id"): cv.entity_id,
        vol.Required(ATTR_CURVE_NAME): cv.string,
        vol.Required(ATTR_POINTS): vol.All(cv.ensure_list),
        vol.Optional(ATTR_SET_ACTIVE, default=False): cv.boolean,
    }
)

DELETE_CURVE_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_ENTRY_ID): cv.string,
        vol.Optional("entity_id"): cv.entity_id,
        vol.Required(ATTR_CURVE_NAME): cv.string,
    }
)

EVALUATE_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_ENTRY_ID): cv.string,
        vol.Optional("entity_id"): cv.entity_id,
    }
)


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Set up the Curve Controller integration global services and frontend resources."""
    hass.data.setdefault(DOMAIN, {})

    # Register frontend static path for the custom Lovelace card
    card_path = Path(__file__).parent / "frontend" / CARD_JS_NAME
    if card_path.exists():
        url_path = f"{URL_BASE}/{CARD_JS_NAME}"
        hass.http.register_static_path(url_path, str(card_path), cache_headers=False)
        _LOGGER.debug("Registered static frontend card at %s", url_path)

        # Attempt automatic registration in Lovelace resources
        await _async_register_lovelace_resource(hass, url_path)
    else:
        _LOGGER.warning("Curve Controller frontend card not found at %s", card_path)

    # Helper to resolve coordinator from service call
    def _get_coordinator(call: ServiceCall) -> CurveControllerCoordinator:
        entries_dict: dict[str, CurveControllerCoordinator] = hass.data.get(DOMAIN, {})
        if not entries_dict:
            raise HomeAssistantError("No active Curve Controller integration configured.")

        entry_id = call.data.get(ATTR_ENTRY_ID)
        entity_id = call.data.get("entity_id")

        if entry_id and entry_id in entries_dict:
            return entries_dict[entry_id]

        if entity_id:
            registry = er.async_get(hass)
            entry = registry.async_get(entity_id)
            if entry and entry.config_entry_id in entries_dict:
                return entries_dict[entry.config_entry_id]

        # If only one instance exists, fallback to it
        if len(entries_dict) == 1:
            return next(iter(entries_dict.values()))

        raise HomeAssistantError(
            "Please provide a valid entry_id or entity_id for Curve Controller."
        )

    # Service handlers
    async def async_handle_select_curve(call: ServiceCall) -> None:
        coordinator = _get_coordinator(call)
        curve_name = call.data[ATTR_CURVE_NAME]
        await coordinator.async_select_curve(curve_name)

    async def async_handle_save_curve(call: ServiceCall) -> None:
        coordinator = _get_coordinator(call)
        curve_name = call.data[ATTR_CURVE_NAME]
        points = call.data[ATTR_POINTS]
        set_active = call.data.get(ATTR_SET_ACTIVE, False)
        await coordinator.async_save_curve(curve_name, points, set_active)

    async def async_handle_delete_curve(call: ServiceCall) -> None:
        coordinator = _get_coordinator(call)
        curve_name = call.data[ATTR_CURVE_NAME]
        await coordinator.async_delete_curve(curve_name)

    async def async_handle_evaluate(call: ServiceCall) -> None:
        coordinator = _get_coordinator(call)
        await coordinator.async_evaluate()

    # Register services under domain
    hass.services.async_register(
        DOMAIN,
        SERVICE_SELECT_CURVE,
        async_handle_select_curve,
        schema=SELECT_CURVE_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_SAVE_CURVE,
        async_handle_save_curve,
        schema=SAVE_CURVE_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_DELETE_CURVE,
        async_handle_delete_curve,
        schema=DELETE_CURVE_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_EVALUATE,
        async_handle_evaluate,
        schema=EVALUATE_SCHEMA,
    )

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Curve Controller from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    coordinator = CurveControllerCoordinator(hass, entry)
    await coordinator.async_setup()

    hass.data[DOMAIN][entry.entry_id] = coordinator

    # Forward setup to sensor and select platforms
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Reload on options change
    entry.async_on_unload(entry.add_update_listener(async_update_options))

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    if unload_ok:
        coordinator: CurveControllerCoordinator | None = hass.data[DOMAIN].pop(
            entry.entry_id, None
        )
        if coordinator:
            await coordinator.async_unload()

    return unload_ok


async def async_update_options(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Handle options update."""
    await hass.config_entries.async_reload(entry.entry_id)


async def _async_register_lovelace_resource(hass: HomeAssistant, url: str) -> None:
    """Automatically register frontend card as a Lovelace resource when possible."""
    try:
        # Check if lovelace resources storage is initialized
        resources = hass.data.get("lovelace_resources") or hass.data.get("lovelace")
        if resources and hasattr(resources, "async_get_resources"):
            existing = await resources.async_get_resources()
            if not any(res.get("url") == url for res in existing):
                await resources.async_create_item({"res_type": "module", "url": url})
                _LOGGER.info("Registered %s in Lovelace resources", url)
    except Exception as err:
        _LOGGER.debug(
            "Could not auto-register Lovelace resource (can be manually added): %s",
            err,
        )

