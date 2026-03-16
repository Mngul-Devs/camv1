import json
from datetime import datetime

from ultralytics import YOLO

from geometry import overlap_ratio


class YoloProcessor:
    def __init__(self, model_path, confidence, overlap_threshold):
        self.model = YOLO(model_path)
        self.confidence = confidence
        self.overlap_threshold = overlap_threshold

    def detect(self, image_path, confidence=None):
        conf = self.confidence if confidence is None else float(confidence)
        results = self.model(image_path, conf=conf)
        if not results:
            return []
        result = results[0]
        detections = []
        for box in result.boxes:
            class_id = int(box.cls)
            class_name = result.names.get(class_id, "unknown")
            confidence = float(box.conf)
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            detections.append(
                {
                    "class": class_name,
                    "confidence": confidence,
                    "bbox": [x1, y1, x2, y2],
                }
            )
        return detections

    def filter_detections_for_zone(self, detections, zone_polygon_px, overlap_threshold=None):
        threshold = self.overlap_threshold if overlap_threshold is None else float(overlap_threshold)
        accepted = []
        for det in detections:
            ratio = overlap_ratio(zone_polygon_px, det["bbox"])
            if ratio >= threshold:
                accepted.append(det)
        return accepted

    @staticmethod
    def to_bbox_json(det, image_width, image_height):
        x1, y1, x2, y2 = det["bbox"]
        width = max(x2 - x1, 1.0)
        height = max(y2 - y1, 1.0)
        return json.dumps(
            {
                "x": (x1 / image_width) * 100.0,
                "y": (y1 / image_height) * 100.0,
                "width": (width / image_width) * 100.0,
                "height": (height / image_height) * 100.0,
            }
        )
