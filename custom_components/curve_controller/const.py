"""Constants for the Curve Controller integration."""
from homeassistant.const import Platform

DOMAIN = "curve_controller"

# Platforms
PLATFORMS = [Platform.SENSOR, Platform.SELECT, Platform.SWITCH]

# Configuration keys
CONF_SOURCE_ENTITY = "source_entity"
CONF_TARGET_ENTITY = "target_entity"
CONF_EVAL_MODE = "eval_mode"
CONF_UPDATE_INTERVAL = "update_interval"
CONF_ROUND_DECIMALS = "round_decimals"

# Evaluation modes
EVAL_MODE_STATE_CHANGE = "state_change"
EVAL_MODE_INTERVAL = "interval"

# Default values
DEFAULT_EVAL_MODE = EVAL_MODE_STATE_CHANGE
DEFAULT_UPDATE_INTERVAL = 300  # seconds (5 minutes)
DEFAULT_ROUND_DECIMALS = 1

# Default initial curves
DEFAULT_CURVES = {
    "Hiver": [
        [-15.0, 55.0],
        [-5.0, 48.0],
        [0.0, 42.0],
        [10.0, 32.0],
        [18.0, 20.0],
    ],
    "Été": [
        [15.0, 18.0],
        [22.0, 20.0],
        [28.0, 23.0],
        [35.0, 26.0],
    ],
    "Nuit": [
        [-15.0, 48.0],
        [-5.0, 40.0],
        [0.0, 35.0],
        [10.0, 26.0],
        [18.0, 18.0],
    ],
    "Absent": [
        [-15.0, 35.0],
        [0.0, 28.0],
        [18.0, 16.0],
    ],
}

# Storage
STORAGE_VERSION = 1
STORAGE_KEY_PREFIX = "curve_controller"

# Services
SERVICE_SELECT_CURVE = "select_curve"
SERVICE_SAVE_CURVE = "save_curve"
SERVICE_DELETE_CURVE = "delete_curve"
SERVICE_EVALUATE = "evaluate"
SERVICE_SET_REGULATION = "set_regulation"

# Service / Event fields
ATTR_CURVE_NAME = "curve_name"
ATTR_POINTS = "points"
ATTR_SET_ACTIVE = "set_active"
ATTR_ENTRY_ID = "entry_id"
ATTR_ENABLED = "enabled"

# Entity Attributes
ATTR_ACTIVE_CURVE = "active_curve"
ATTR_CURVES = "curves"
ATTR_SOURCE_ENTITY = "source_entity"
ATTR_SOURCE_VALUE = "source_value"
ATTR_TARGET_ENTITY = "target_entity"
ATTR_CALCULATED_VALUE = "calculated_value"
ATTR_POINTS_LIST = "points"
ATTR_REGULATION_ENABLED = "regulation_enabled"
ATTR_SOURCE_UNIT = "source_unit"
ATTR_TARGET_UNIT = "target_unit"

# Frontend card registration
URL_BASE = "/curve_controller_frontend"
CARD_JS_NAME = "curve-controller-card.js"

