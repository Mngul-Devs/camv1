from dataclasses import dataclass
from typing import List, Tuple

import numpy as np
from PIL import Image

from . import config
from .preprocess import crop_zone, preprocess_for_model
from .runtime_onnx import OnnxRuntime


@dataclass
class ZonePrediction:
    probability: float
    occupied: bool


class ZoneClassifier:
    def __init__(
        self,
        mode: str,
        model_path: str,
        threshold: float,
        input_size: int,
        mean: List[float],
        std: List[float],
        pad_ratio: float,
        placeholder_prob: float,
    ):
        self.mode = mode
        self.model_path = model_path
        self.threshold = threshold
        self.input_size = input_size
        self.mean = mean
        self.std = std
        self.pad_ratio = pad_ratio
        self.placeholder_prob = placeholder_prob
        self.runtime = None
        if self.mode == "onnx":
            try:
                self.runtime = OnnxRuntime(self.model_path)
            except Exception as exc:
                print(f"ZoneCls ONNX load failed, falling back to placeholder: {exc}")
                self.mode = "placeholder"
                self.runtime = None

    @classmethod
    def from_env(cls):
        return cls(
            mode=config.ZONECLS_MODE,
            model_path=config.ZONECLS_MODEL_PATH,
            threshold=config.ZONECLS_THRESHOLD,
            input_size=config.ZONECLS_INPUT_SIZE,
            mean=config.ZONECLS_MEAN,
            std=config.ZONECLS_STD,
            pad_ratio=config.ZONECLS_PAD_RATIO,
            placeholder_prob=config.ZONECLS_PLACEHOLDER_PROB,
        )

    def predict_zone_occupied(
        self, image: Image.Image, zone_polygon_percent: List[List[float]]
    ) -> ZonePrediction:
        if self.mode != "onnx" or self.runtime is None:
            prob = float(self.placeholder_prob)
            return ZonePrediction(probability=prob, occupied=prob >= self.threshold)

        crop, _bbox = crop_zone(image, zone_polygon_percent, self.pad_ratio)
        input_tensor = preprocess_for_model(crop, self.input_size, self.mean, self.std)
        prob = float(self.runtime.predict(input_tensor))
        return ZonePrediction(probability=prob, occupied=prob >= self.threshold)
