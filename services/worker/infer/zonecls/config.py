import os


def _get_float(name, default):
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return float(default)


def _get_int(name, default):
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return int(default)


ZONECLS_MODE = os.getenv("ZONECLS_MODE", "placeholder").lower()
ZONECLS_MODEL_PATH = os.getenv("ZONECLS_MODEL_PATH", "/models/zonecls.onnx")
ZONECLS_THRESHOLD = _get_float("ZONECLS_THRESHOLD", "0.55")
ZONECLS_INPUT_SIZE = _get_int("ZONECLS_INPUT_SIZE", "224")
ZONECLS_PAD_RATIO = _get_float("ZONECLS_PAD_RATIO", "0.10")
ZONECLS_PLACEHOLDER_PROB = _get_float("ZONECLS_PLACEHOLDER_PROB", "0.0")

ZONECLS_MEAN = [
    _get_float("ZONECLS_MEAN_R", "0.485"),
    _get_float("ZONECLS_MEAN_G", "0.456"),
    _get_float("ZONECLS_MEAN_B", "0.406"),
]
ZONECLS_STD = [
    _get_float("ZONECLS_STD_R", "0.229"),
    _get_float("ZONECLS_STD_G", "0.224"),
    _get_float("ZONECLS_STD_B", "0.225"),
]
