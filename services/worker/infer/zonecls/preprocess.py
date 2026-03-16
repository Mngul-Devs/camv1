from typing import List, Tuple

import numpy as np
from PIL import Image


def polygon_percent_to_pixels(
    polygon_percent: List[List[float]], width: int, height: int
) -> List[Tuple[float, float]]:
    return [(p[0] / 100.0 * width, p[1] / 100.0 * height) for p in polygon_percent]


def polygon_bbox(polygon_px: List[Tuple[float, float]]):
    xs = [p[0] for p in polygon_px]
    ys = [p[1] for p in polygon_px]
    return min(xs), min(ys), max(xs), max(ys)


def crop_zone(
    image: Image.Image,
    polygon_percent: List[List[float]],
    pad_ratio: float,
):
    width, height = image.size
    polygon_px = polygon_percent_to_pixels(polygon_percent, width, height)
    min_x, min_y, max_x, max_y = polygon_bbox(polygon_px)

    pad_x = (max_x - min_x) * pad_ratio
    pad_y = (max_y - min_y) * pad_ratio

    left = max(min_x - pad_x, 0)
    top = max(min_y - pad_y, 0)
    right = min(max_x + pad_x, width)
    bottom = min(max_y + pad_y, height)

    left_i, top_i, right_i, bottom_i = map(int, [left, top, right, bottom])
    if right_i <= left_i or bottom_i <= top_i:
        return image.copy(), (0, 0, width, height)
    return image.crop((left_i, top_i, right_i, bottom_i)), (left_i, top_i, right_i, bottom_i)


def preprocess_for_model(
    crop: Image.Image,
    input_size: int,
    mean: List[float],
    std: List[float],
):
    resized = crop.convert("RGB").resize((input_size, input_size), Image.Resampling.BILINEAR)
    array = np.asarray(resized, dtype=np.float32) / 255.0
    array = (array - np.array(mean, dtype=np.float32)) / np.array(std, dtype=np.float32)
    array = np.transpose(array, (2, 0, 1))
    return array[None, ...]
