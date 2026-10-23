"""Config flow for Curve Controller integration."""
from __future__ import annotations

from typing import Any
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import (
    DOMAIN,
    CONF_SOURCE_ENTITY,
    CONF_TARGET_ENTITY,
    CONF_EVAL_MODE,
    CONF_UPDATE_INTERVAL,
    CONF_ROUND_DECIMALS,
    EVAL_MODE_STATE_CHANGE,
    EVAL_MODE_INTERVAL,
    DEFAULT_EVAL_MODE,
    DEFAULT_UPDATE_INTERVAL,
    DEFAULT_ROUND_DECIMALS,
)


class CurveControllerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Curve Controller."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            title = user_input.get("name", "Curve Controller")
            return self.async_create_entry(title=title, data=user_input)

        data_schema = vol.Schema(
            {
                vol.Required("name", default="Curve Controller"): selector.TextSelector(
                    selector.TextSelectorConfig(type=selector.TextSelectorType.TEXT)
                ),
                vol.Required(CONF_SOURCE_ENTITY): selector.EntitySelector(
                    selector.EntitySelectorConfig()
                ),
                vol.Required(CONF_TARGET_ENTITY): selector.EntitySelector(
                    selector.EntitySelectorConfig()
                ),
                vol.Required(
                    CONF_EVAL_MODE, default=DEFAULT_EVAL_MODE
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=[
                            selector.SelectOptionDict(
                                value=EVAL_MODE_STATE_CHANGE,
                                label="À chaque changement d'état de l'entrée",
                            ),
                            selector.SelectOptionDict(
                                value=EVAL_MODE_INTERVAL,
                                label="Périodique (intervalle régulier)",
                            ),
                        ],
                        mode=selector.SelectSelectorMode.DROPDOWN,
                    )
                ),
                vol.Optional(
                    CONF_UPDATE_INTERVAL, default=DEFAULT_UPDATE_INTERVAL
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(
                        min=5,
                        max=86400,
                        step=5,
                        unit_of_measurement="sec",
                        mode=selector.NumberSelectorMode.BOX,
                    )
                ),
                vol.Optional(
                    CONF_ROUND_DECIMALS, default=DEFAULT_ROUND_DECIMALS
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(
                        min=0,
                        max=4,
                        step=1,
                        mode=selector.NumberSelectorMode.BOX,
                    )
                ),
            }
        )

        return self.async_show_form(
            step_id="user", data_schema=data_schema, errors=errors
        )

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        """Get the options flow for this handler."""
        return CurveControllerOptionsFlow(config_entry)


class CurveControllerOptionsFlow(config_entries.OptionsFlow):
    """Handle options flow for Curve Controller."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """Initialize options flow."""
        self.config_entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Manage options."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        current_source = self.config_entry.options.get(
            CONF_SOURCE_ENTITY,
            self.config_entry.data.get(CONF_SOURCE_ENTITY),
        )
        current_target = self.config_entry.options.get(
            CONF_TARGET_ENTITY,
            self.config_entry.data.get(CONF_TARGET_ENTITY),
        )
        current_mode = self.config_entry.options.get(
            CONF_EVAL_MODE,
            self.config_entry.data.get(CONF_EVAL_MODE, DEFAULT_EVAL_MODE),
        )
        current_interval = self.config_entry.options.get(
            CONF_UPDATE_INTERVAL,
            self.config_entry.data.get(CONF_UPDATE_INTERVAL, DEFAULT_UPDATE_INTERVAL),
        )
        current_decimals = self.config_entry.options.get(
            CONF_ROUND_DECIMALS,
            self.config_entry.data.get(CONF_ROUND_DECIMALS, DEFAULT_ROUND_DECIMALS),
        )

        data_schema = vol.Schema(
            {
                vol.Required(
                    CONF_SOURCE_ENTITY, default=current_source
                ): selector.EntitySelector(selector.EntitySelectorConfig()),
                vol.Required(
                    CONF_TARGET_ENTITY, default=current_target
                ): selector.EntitySelector(selector.EntitySelectorConfig()),
                vol.Required(
                    CONF_EVAL_MODE, default=current_mode
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=[
                            selector.SelectOptionDict(
                                value=EVAL_MODE_STATE_CHANGE,
                                label="À chaque changement d'état de l'entrée",
                            ),
                            selector.SelectOptionDict(
                                value=EVAL_MODE_INTERVAL,
                                label="Périodique (intervalle régulier)",
                            ),
                        ],
                        mode=selector.SelectSelectorMode.DROPDOWN,
                    )
                ),
                vol.Optional(
                    CONF_UPDATE_INTERVAL, default=current_interval
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(
                        min=5,
                        max=86400,
                        step=5,
                        unit_of_measurement="sec",
                        mode=selector.NumberSelectorMode.BOX,
                    )
                ),
                vol.Optional(
                    CONF_ROUND_DECIMALS, default=current_decimals
                ): selector.NumberSelector(
                    selector.NumberSelectorConfig(
                        min=0,
                        max=4,
                        step=1,
                        mode=selector.NumberSelectorMode.BOX,
                    )
                ),
            }
        )

        return self.async_show_form(step_id="init", data_schema=data_schema)

