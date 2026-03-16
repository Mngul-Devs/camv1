import numpy as np
import onnxruntime as ort


class OnnxRuntime:
    def __init__(self, model_path: str):
        self.session = ort.InferenceSession(
            model_path,
            providers=["CPUExecutionProvider"],
        )
        self.input_name = self.session.get_inputs()[0].name
        outputs = self.session.get_outputs()
        self.output_name = outputs[0].name if outputs else None

    def predict(self, input_tensor: np.ndarray) -> float:
        output = self.session.run([self.output_name], {self.input_name: input_tensor})[0]
        output = np.asarray(output)
        if output.ndim == 2 and output.shape[1] == 2:
            return float(_softmax(output)[0, 1])
        if output.ndim == 2 and output.shape[1] == 1:
            return float(_sigmoid(output)[0, 0])
        if output.ndim == 1 and output.shape[0] == 1:
            return float(_sigmoid(output)[0])
        raise ValueError("Unexpected ONNX output shape")


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def _softmax(x: np.ndarray) -> np.ndarray:
    x = x - np.max(x, axis=1, keepdims=True)
    exp = np.exp(x)
    return exp / np.sum(exp, axis=1, keepdims=True)
