# train_snake.py
import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
import json


class SnakeAI(nn.Module):
    def __init__(self, input_size, hidden_size, output_size):
        super().__init__()
        self.fc1 = nn.Linear(input_size, hidden_size)
        self.fc2 = nn.Linear(hidden_size, hidden_size)
        self.fc3 = nn.Linear(hidden_size, output_size)
        self.relu = nn.ReLU()

    def forward(self, x):
        x = self.relu(self.fc1(x))
        x = self.relu(self.fc2(x))
        return self.fc3(x)


# Сохраняем веса в формате для ONNX или чистый PyTorch
def save_model_for_web(model, path="model.pt"):
    # Сохраняем state_dict
    torch.save(model.state_dict(), path)

    # Сохраняем архитектуру в JSON
    config = {
        "input_size": 24,  # 8 направлений * 3 (стена, еда, хвост)
        "hidden_size": 256,
        "output_size": 4  # вверх, вниз, влево, вправо
    }
    with open("model_config.json", "w") as f:
        json.dump(config, f)


# Обучаем и сохраняем
model = SnakeAI(24, 256, 4)
# ... ваш код обучения ...
save_model_for_web(model)