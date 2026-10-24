"""The Curve Controller integration."""
from __future__ import annotations

import copy
import json
import logging
from pathlib import Path
import re
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import HomeAssistantError
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers import entity_registry as er

try:
    from homeassistant.helpers.target import async_extract_referenced_entity_ids
except ImportError:
    try:
        from homeassistant.helpers.service import async_extract_referenced_entity_ids
    except ImportError:
        async_extract_referenced_entity_ids = None

try:
    from homeassistant.helpers.service import async_set_service_schema
except ImportError:
    async_set_service_schema = None

from .const import (
    DOMAIN,
    PLATFORMS,
    URL_BASE,
    CARD_JS_NAME,
    SERVICE_SELECT_CURVE,
    SERVICE_SAVE_CURVE,
    SERVICE_DELETE_CURVE,
    SERVICE_EVALUATE,
    SERVICE_SET_REGULATION,
    SERVICE_ADJUST_CURVE_OFFSET,
    SERVICE_COPY_CURVE,
    SERVICE_RESET_CURVES,
    ATTR_CURVE_NAME,
    ATTR_POINTS,
    ATTR_SET_ACTIVE,
    ATTR_ENTRY_ID,
    ATTR_ENABLED,
    ATTR_OFFSET,
    ATTR_NEW_CURVE_NAME,
    ATTR_CONFIRM,
    ATTR_SOURCE_ENTITY,
)
from .coordinator import CurveControllerCoordinator

_LOGGER = logging.getLogger(__name__)

# Base permissive schemas for Voluptuous registration (Home Assistant injects target parameters)
SELECT_CURVE_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_CURVE_NAME): cv.string,
    },
    extra=vol.ALLOW_EXTRA,
)

SAVE_CURVE_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_CURVE_NAME): cv.string,
        vol.Required(ATTR_POINTS): object,
        vol.Optional(ATTR_SET_ACTIVE, default=False): cv.boolean,
    },
    extra=vol.ALLOW_EXTRA,
)

DELETE_CURVE_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_CURVE_NAME): cv.string,
    },
    extra=vol.ALLOW_EXTRA,
)

EVALUATE_SCHEMA = vol.Schema(
    {},
    extra=vol.ALLOW_EXTRA,
)

SET_REGULATION_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ENABLED): cv.boolean,
    },
    extra=vol.ALLOW_EXTRA,
)

ADJUST_CURVE_OFFSET_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_OFFSET): vol.Coerce(float),
        vol.Optional(ATTR_CURVE_NAME): cv.string,
    },
    extra=vol.ALLOW_EXTRA,
)

COPY_CURVE_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_SOURCE_ENTITY): cv.string,
        vol.Required(ATTR_CURVE_NAME): cv.string,
        vol.Optional(ATTR_NEW_CURVE_NAME): cv.string,
        vol.Optional(ATTR_SET_ACTIVE, default=False): cv.boolean,
    },
    extra=vol.ALLOW_EXTRA,
)

RESET_CURVES_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_CONFIRM, default=True): cv.boolean,
    },
    extra=vol.ALLOW_EXTRA,
)


def parse_curve_points(raw_points: Any) -> list[list[float]]:
    """Parse and sanitize points in various formats (list, dict, text, JSON)."""
    cleaned: list[list[float]] = []

    if isinstance(raw_points, str):
        trimmed = raw_points.strip()
        if (trimmed.startswith("[") and trimmed.endswith("]")) or (
            trimmed.startswith("{") and trimmed.endswith("}")
        ):
            try:
                raw_points = json.loads(trimmed)
            except Exception:
                pass

    if isinstance(raw_points, str):
        # Format like: "-15: 50, 0: 42, 10: 32" or "-15,50; 0,42" or "-15 50\n0 42"
        segments = re.split(r"[;\n]+", raw_points.strip())
        for seg in segments:
            seg = seg.strip()
            if not seg:
                continue
            parts = re.split(r"[,:\s]+", seg)
            if len(parts) >= 2:
                try:
                    cleaned.append([float(parts[0]), float(parts[1])])
                except (ValueError, TypeError):
                    continue
        if not cleaned:
            numbers = re.findall(r"[-+]?\d*\.?\d+", raw_points)
            if len(numbers) >= 2 and len(numbers) % 2 == 0:
                for i in range(0, len(numbers), 2):
                    cleaned.append([float(numbers[i]), float(numbers[i + 1])])
    elif isinstance(raw_points, (list, tuple)):
        for item in raw_points:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                try:
                    cleaned.append([float(item[0]), float(item[1])])
                except (ValueError, TypeError):
                    continue
            elif isinstance(item, dict):
                x = item.get("x", item.get("X"))
                y = item.get("y", item.get("Y"))
                if x is not None and y is not None:
                    try:
                        cleaned.append([float(x), float(y)])
                    except (ValueError, TypeError):
                        continue

    if len(cleaned) < 2:
        raise HomeAssistantError(
            "Une courbe doit comporter au moins 2 points [X, Y]. Format de points non valide."
        )

    # Sort ascending by X
    cleaned.sort(key=lambda pt: pt[0])
    return cleaned


def _get_target_coordinators(
    hass: HomeAssistant, call: ServiceCall
) -> list[CurveControllerCoordinator]:
    """Resolve all CurveControllerCoordinator instances targeted by a service call."""
    entries_dict: dict[str, CurveControllerCoordinator] = hass.data.get(DOMAIN, {})
    if not entries_dict:
        raise HomeAssistantError("Aucune instance Curve Controller active n'est configurée.")

    entity_ids: set[str] = set()

    # 1. Standard HA target extraction (resolves entities, devices, areas)
    if async_extract_referenced_entity_ids is not None:
        try:
            referenced = async_extract_referenced_entity_ids(hass, call)
            entity_ids.update(referenced.referenced)
            entity_ids.update(referenced.indirectly_referenced)
        except Exception as err:
            _LOGGER.debug("Target extraction error: %s", err)

    # 2. Check call.data entity_id (string or list)
    raw_entities = call.data.get("entity_id")
    if isinstance(raw_entities, str):
        entity_ids.add(raw_entities)
    elif isinstance(raw_entities, (list, set, tuple)):
        entity_ids.update(raw_entities)

    # Also check if target dict is passed in call.data
    target_data = call.data.get("target")
    if isinstance(target_data, dict):
        target_entities = target_data.get("entity_id")
        if isinstance(target_entities, str):
            entity_ids.add(target_entities)
        elif isinstance(target_entities, (list, set, tuple)):
            entity_ids.update(target_entities)

    # 3. Direct entry_id(s)
    raw_entries = call.data.get(ATTR_ENTRY_ID)
    direct_entry_ids: set[str] = set()
    if isinstance(raw_entries, str):
        direct_entry_ids.add(raw_entries)
    elif isinstance(raw_entries, (list, set, tuple)):
        direct_entry_ids.update(raw_entries)

    matched: dict[str, CurveControllerCoordinator] = {}

    # Match direct entry IDs
    for eid in direct_entry_ids:
        if eid in entries_dict:
            matched[eid] = entries_dict[eid]

    # Match entities through Entity Registry or states
    registry = er.async_get(hass)
    for eid in entity_ids:
        if not eid or not isinstance(eid, str):
            continue
        reg_entry = registry.async_get(eid)
        if reg_entry and reg_entry.config_entry_id in entries_dict:
            matched[reg_entry.config_entry_id] = entries_dict[reg_entry.config_entry_id]
            continue
        # Fallback to extra_state_attributes
        state = hass.states.get(eid)
        if state and state.attributes:
            stored_entry_id = state.attributes.get(ATTR_ENTRY_ID)
            if stored_entry_id and stored_entry_id in entries_dict:
                matched[stored_entry_id] = entries_dict[stored_entry_id]

    if matched:
        return list(matched.values())

    # Fallback: if only one coordinator exists in Home Assistant, target it
    if len(entries_dict) == 1:
        return [next(iter(entries_dict.values()))]

    raise HomeAssistantError(
        "Veuillez sélectionner au moins une entité Curve Controller cible."
    )


@callback
def async_update_services_schema(hass: HomeAssistant) -> None:
    """Dynamically update service schema options with all currently existing curve names."""
    if async_set_service_schema is None:
        return
    entries_dict: dict[str, CurveControllerCoordinator] = hass.data.get(DOMAIN, {})
    all_curves_set: set[str] = set()
    for coord in entries_dict.values():
        all_curves_set.update(coord.curves.keys())

    if not all_curves_set:
        all_curves_set = {"Hiver", "Été", "Nuit", "Absent"}

    sorted_curves = sorted(list(all_curves_set))

    # Dynamically update select_curve
    async_set_service_schema(
        hass,
        DOMAIN,
        SERVICE_SELECT_CURVE,
        {
            "name": "Sélectionner la courbe active",
            "description": "Bascule la courbe active pour une ou plusieurs entités Curve Controller.",
            "target": {
                "entity": {
                    "integration": DOMAIN,
                }
            },
            "fields": {
                ATTR_CURVE_NAME: {
                    "name": "Nom de la courbe",
                    "description": "Choisissez une courbe disponible dans la liste déroulante ou saisissez le nom d'une courbe personnalisée.",
                    "required": True,
                    "example": sorted_curves[0],
                    "selector": {
                        "select": {
                            "options": sorted_curves,
                            "custom_value": True,
                            "mode": "dropdown",
                        }
                    },
                },
                "entity_id": {
                    "name": "Entité(s) cible(s)",
                    "description": "Entité(s) Curve Controller ciblées (optionnel si la cible est définie ci-dessus).",
                    "required": False,
                    "selector": {
                        "entity": {
                            "integration": DOMAIN,
                            "multiple": True,
                        }
                    },
                },
            },
        },
    )

    # Dynamically update save_curve
    async_set_service_schema(
        hass,
        DOMAIN,
        SERVICE_SAVE_CURVE,
        {
            "name": "Sauvegarder ou créer une courbe",
            "description": "Crée ou met à jour les coordonnées d'une courbe (points X, Y) pour une ou plusieurs entités.",
            "target": {
                "entity": {
                    "integration": DOMAIN,
                }
            },
            "fields": {
                ATTR_CURVE_NAME: {
                    "name": "Nom de la courbe",
                    "description": "Choisissez une courbe existante à remplacer ou tapez un nouveau nom.",
                    "required": True,
                    "example": sorted_curves[0],
                    "selector": {
                        "select": {
                            "options": sorted_curves,
                            "custom_value": True,
                            "mode": "dropdown",
                        }
                    },
                },
                ATTR_POINTS: {
                    "name": "Points de la courbe [X, Y]",
                    "description": "Liste de coordonnées sous forme [[X, Y], ...], [{'x': X, 'y': Y}], ou texte (ex. '-10: 50, 0: 42, 10: 32, 20: 20').",
                    "required": True,
                    "example": "[[-15, 50], [0, 42], [10, 32], [20, 20]]",
                    "selector": {"object": {}},
                },
                ATTR_SET_ACTIVE: {
                    "name": "Activer immédiatement",
                    "description": "Définir immédiatement cette courbe comme la courbe active après la sauvegarde.",
                    "required": False,
                    "default": False,
                    "selector": {"boolean": {}},
                },
                "entity_id": {
                    "name": "Entité(s) cible(s)",
                    "description": "Entité(s) Curve Controller ciblées (optionnel si la cible est définie ci-dessus).",
                    "required": False,
                    "selector": {
                        "entity": {
                            "integration": DOMAIN,
                            "multiple": True,
                        }
                    },
                },
            },
        },
    )

    # Dynamically update delete_curve
    async_set_service_schema(
        hass,
        DOMAIN,
        SERVICE_DELETE_CURVE,
        {
            "name": "Supprimer une courbe",
            "description": "Supprime une courbe existante d'une ou plusieurs entités Curve Controller.",
            "target": {
                "entity": {
                    "integration": DOMAIN,
                }
            },
            "fields": {
                ATTR_CURVE_NAME: {
                    "name": "Nom de la courbe",
                    "description": "Sélectionnez la courbe à supprimer.",
                    "required": True,
                    "example": sorted_curves[0],
                    "selector": {
                        "select": {
                            "options": sorted_curves,
                            "custom_value": True,
                            "mode": "dropdown",
                        }
                    },
                },
                "entity_id": {
                    "name": "Entité(s) cible(s)",
                    "description": "Entité(s) Curve Controller ciblées (optionnel si la cible est définie ci-dessus).",
                    "required": False,
                    "selector": {
                        "entity": {
                            "integration": DOMAIN,
                            "multiple": True,
                        }
                    },
                },
            },
        },
    )

    # Dynamically update adjust_curve_offset
    async_set_service_schema(
        hass,
        DOMAIN,
        SERVICE_ADJUST_CURVE_OFFSET,
        {
            "name": "Ajuster le décalage d'une courbe (Offset)",
            "description": "Décale verticalement tous les points Y d'une courbe (ex. +1.5 °C ou -2 °C) pour ajuster rapidement le confort.",
            "target": {
                "entity": {
                    "integration": DOMAIN,
                }
            },
            "fields": {
                ATTR_OFFSET: {
                    "name": "Valeur du décalage (Offset)",
                    "description": "Valeur positive ou négative à ajouter à tous les points Y de la courbe.",
                    "required": True,
                    "example": 1.5,
                    "selector": {
                        "number": {
                            "min": -50,
                            "max": 50,
                            "step": 0.1,
                            "mode": "box",
                        }
                    },
                },
                ATTR_CURVE_NAME: {
                    "name": "Nom de la courbe (optionnel)",
                    "description": "Courbe à ajuster. Laissez vide pour appliquer directement à la courbe actuellement active de chaque entité.",
                    "required": False,
                    "selector": {
                        "select": {
                            "options": sorted_curves,
                            "custom_value": True,
                            "mode": "dropdown",
                        }
                    },
                },
                "entity_id": {
                    "name": "Entité(s) cible(s)",
                    "description": "Entité(s) Curve Controller ciblées (optionnel si la cible est définie ci-dessus).",
                    "required": False,
                    "selector": {
                        "entity": {
                            "integration": DOMAIN,
                            "multiple": True,
                        }
                    },
                },
            },
        },
    )

    # Dynamically update copy_curve
    async_set_service_schema(
        hass,
        DOMAIN,
        SERVICE_COPY_CURVE,
        {
            "name": "Copier une courbe entre entités",
            "description": "Copie la configuration d'une courbe depuis une entité source vers une ou plusieurs entités cibles.",
            "target": {
                "entity": {
                    "integration": DOMAIN,
                }
            },
            "fields": {
                ATTR_SOURCE_ENTITY: {
                    "name": "Entité source",
                    "description": "Entité Curve Controller d'origine contenant la courbe à dupliquer.",
                    "required": True,
                    "selector": {
                        "entity": {
                            "integration": DOMAIN,
                        }
                    },
                },
                ATTR_CURVE_NAME: {
                    "name": "Nom de la courbe à copier",
                    "description": "Nom de la courbe à dupliquer depuis l'entité source.",
                    "required": True,
                    "selector": {
                        "select": {
                            "options": sorted_curves,
                            "custom_value": True,
                            "mode": "dropdown",
                        }
                    },
                },
                ATTR_NEW_CURVE_NAME: {
                    "name": "Nouveau nom sur la cible (optionnel)",
                    "description": "Nom de la courbe sur les entités cibles. Si non renseigné, le nom d'origine est conservé.",
                    "required": False,
                    "selector": {"text": {}},
                },
                ATTR_SET_ACTIVE: {
                    "name": "Activer immédiatement sur les cibles",
                    "description": "Définir comme courbe active sur les entités cibles.",
                    "required": False,
                    "default": False,
                    "selector": {"boolean": {}},
                },
                "entity_id": {
                    "name": "Entité(s) cible(s)",
                    "description": "Entité(s) Curve Controller de destination (optionnel si la cible est définie ci-dessus).",
                    "required": False,
                    "selector": {
                        "entity": {
                            "integration": DOMAIN,
                            "multiple": True,
                        }
                    },
                },
            },
        },
    )


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Set up the Curve Controller integration global services and frontend resources."""
    hass.data.setdefault(DOMAIN, {})

    # Register frontend static path for the custom Lovelace card
    card_path = Path(__file__).parent / "frontend" / CARD_JS_NAME
    if card_path.exists():
        url_path = f"{URL_BASE}/{CARD_JS_NAME}"
        try:
            if hasattr(hass.http, "async_register_static_paths"):
                from homeassistant.components.http import StaticPathConfig

                await hass.http.async_register_static_paths(
                    [StaticPathConfig(url_path, str(card_path), cache_headers=False)]
                )
            elif hasattr(hass.http, "register_static_path"):
                hass.http.register_static_path(url_path, str(card_path), cache_headers=False)
            _LOGGER.debug("Registered static frontend card at %s", url_path)
        except Exception as err:
            _LOGGER.warning("Could not register static frontend path: %s", err)

        # Attempt automatic registration in Lovelace resources
        await _async_register_lovelace_resource(hass, url_path)
    else:
        _LOGGER.warning("Curve Controller frontend card not found at %s", card_path)

    # Service handlers
    async def async_handle_select_curve(call: ServiceCall) -> None:
        coordinators = _get_target_coordinators(hass, call)
        curve_name = str(call.data[ATTR_CURVE_NAME]).strip()

        # Check curve availability across all targeted coordinators
        curves_per_coord = {c: set(c.curves.keys()) for c in coordinators}
        common_curves = (
            set.intersection(*curves_per_coord.values()) if curves_per_coord else set()
        )

        if curve_name not in common_curves:
            missing_entities = [
                f"{c.entry.title} (courbes : {', '.join(sorted(curves_per_coord[c]))})"
                for c in coordinators
                if curve_name not in curves_per_coord[c]
            ]
            common_list = sorted(common_curves)
            msg = (
                f"La courbe '{curve_name}' n'est pas commune à toutes les entités sélectionnées.\n"
                f"Entités ne disposant pas de cette courbe : {'; '.join(missing_entities)}.\n"
                f"Courbes communes disponibles : {', '.join(common_list) if common_list else 'Aucune courbe en commun'}."
            )
            raise HomeAssistantError(msg)

        for coord in coordinators:
            await coord.async_select_curve(curve_name)

    async def async_handle_save_curve(call: ServiceCall) -> None:
        coordinators = _get_target_coordinators(hass, call)
        curve_name = str(call.data[ATTR_CURVE_NAME]).strip()
        points = parse_curve_points(call.data[ATTR_POINTS])
        set_active = call.data.get(ATTR_SET_ACTIVE, False)

        for coord in coordinators:
            await coord.async_save_curve(curve_name, points, set_active)

        async_update_services_schema(hass)

    async def async_handle_delete_curve(call: ServiceCall) -> None:
        coordinators = _get_target_coordinators(hass, call)
        curve_name = str(call.data[ATTR_CURVE_NAME]).strip()

        for coord in coordinators:
            if curve_name in coord.curves:
                await coord.async_delete_curve(curve_name)

        async_update_services_schema(hass)

    async def async_handle_evaluate(call: ServiceCall) -> None:
        coordinators = _get_target_coordinators(hass, call)
        for coord in coordinators:
            await coord.async_evaluate()

    async def async_handle_set_regulation(call: ServiceCall) -> None:
        coordinators = _get_target_coordinators(hass, call)
        enabled = bool(call.data[ATTR_ENABLED])
        for coord in coordinators:
            await coord.async_set_enabled(enabled)

    async def async_handle_adjust_curve_offset(call: ServiceCall) -> None:
        coordinators = _get_target_coordinators(hass, call)
        offset = float(call.data[ATTR_OFFSET])
        curve_name = call.data.get(ATTR_CURVE_NAME)
        if curve_name:
            curve_name = str(curve_name).strip()

        for coord in coordinators:
            await coord.async_offset_curve(offset, curve_name)

    async def async_handle_copy_curve(call: ServiceCall) -> None:
        source_entity = str(call.data[ATTR_SOURCE_ENTITY]).strip()
        curve_name = str(call.data[ATTR_CURVE_NAME]).strip()
        new_name = call.data.get(ATTR_NEW_CURVE_NAME)
        if new_name:
            new_name = str(new_name).strip()
        target_name = new_name or curve_name
        set_active = call.data.get(ATTR_SET_ACTIVE, False)

        # Resolve source coordinator
        entries_dict: dict[str, CurveControllerCoordinator] = hass.data.get(DOMAIN, {})
        source_coord: CurveControllerCoordinator | None = None

        registry = er.async_get(hass)
        reg_entry = registry.async_get(source_entity)
        if reg_entry and reg_entry.config_entry_id in entries_dict:
            source_coord = entries_dict[reg_entry.config_entry_id]
        else:
            state = hass.states.get(source_entity)
            if state and state.attributes:
                eid = state.attributes.get(ATTR_ENTRY_ID)
                if eid and eid in entries_dict:
                    source_coord = entries_dict[eid]

        if not source_coord:
            raise HomeAssistantError(
                f"Entité source Curve Controller '{source_entity}' introuvable."
            )

        if curve_name not in source_coord.curves:
            raise HomeAssistantError(
                f"Courbe '{curve_name}' introuvable dans l'entité source {source_coord.entry.title}."
            )

        source_points = copy.deepcopy(source_coord.curves[curve_name])
        target_coordinators = _get_target_coordinators(hass, call)

        for coord in target_coordinators:
            await coord.async_save_curve(target_name, source_points, set_active)

        async_update_services_schema(hass)

    async def async_handle_reset_curves(call: ServiceCall) -> None:
        confirm = call.data.get(ATTR_CONFIRM, True)
        if not confirm:
            return
        coordinators = _get_target_coordinators(hass, call)
        for coord in coordinators:
            await coord.async_reset_curves()

        async_update_services_schema(hass)

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
    hass.services.async_register(
        DOMAIN,
        SERVICE_SET_REGULATION,
        async_handle_set_regulation,
        schema=SET_REGULATION_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_ADJUST_CURVE_OFFSET,
        async_handle_adjust_curve_offset,
        schema=ADJUST_CURVE_OFFSET_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_COPY_CURVE,
        async_handle_copy_curve,
        schema=COPY_CURVE_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_RESET_CURVES,
        async_handle_reset_curves,
        schema=RESET_CURVES_SCHEMA,
    )

    # Initialize dynamic service descriptions
    async_update_services_schema(hass)

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Curve Controller from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    coordinator = CurveControllerCoordinator(hass, entry)
    await coordinator.async_setup()

    hass.data[DOMAIN][entry.entry_id] = coordinator

    # Forward setup to sensor, select, and switch platforms
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Update dynamic service schema with curves from this entry
    async_update_services_schema(hass)

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

        # Update dynamic service schema options after unloading
        async_update_services_schema(hass)

    return unload_ok


async def async_update_options(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Handle options update."""
    await hass.config_entries.async_reload(entry.entry_id)


async def _async_register_lovelace_resource(hass: HomeAssistant, url: str) -> None:
    """Automatically register frontend card as a Lovelace resource when possible."""
    try:
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
