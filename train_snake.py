import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
import random
import json
from collections import deque
import os

# ========== НАСТРОЙКИ ==========
GRID_SIZE = 12
MAX_MEMORY = 200_000
BATCH_SIZE = 2048
LR = 0.0005
GAMMA = 0.99
TAU = 0.001  # Soft update
EPSILON_START = 1.0
EPSILON_END = 0.01
EPSILON_DECAY = 0.9995
UPDATE_EVERY = 10


# ========== УЛУЧШЕННАЯ МОДЕЛЬ ==========
class DQN(nn.Module):
    def __init__(self, input_size=24, hidden_size=512, output_size=4):
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(input_size, hidden_size),
            nn.LayerNorm(hidden_size),
            nn.ReLU(),
            nn.Dropout(0.1),

            nn.Linear(hidden_size, hidden_size // 2),
            nn.LayerNorm(hidden_size // 2),
            nn.ReLU(),
            nn.Dropout(0.1),

            nn.Linear(hidden_size // 2, hidden_size // 4),
            nn.ReLU(),
            nn.Linear(hidden_size // 4, output_size)
        )

    def forward(self, x):
        return self.network(x)


# ========== БУФЕР РЕПЛЕЙ ==========
class ReplayBuffer:
    def __init__(self, capacity):
        self.buffer = deque(maxlen=capacity)
        self.capacity = capacity

    def push(self, state, action, reward, next_state, done):
        self.buffer.append((state, action, reward, next_state, done))

    def sample(self, batch_size):
        batch = random.sample(self.buffer, batch_size)
        states, actions, rewards, next_states, dones = zip(*batch)

        return (
            np.array(states, dtype=np.float32),
            np.array(actions, dtype=np.int64),
            np.array(rewards, dtype=np.float32),
            np.array(next_states, dtype=np.float32),
            np.array(dones, dtype=np.float32)
        )

    def __len__(self):
        return len(self.buffer)


# ========== ИГРА ==========
class SnakeGame:
    def __init__(self):
        self.grid_size = GRID_SIZE
        self.reset()

    def reset(self):
        center = self.grid_size // 2
        self.snake = [(center, center), (center - 1, center), (center - 2, center)]
        self.direction = (1, 0)
        self.food = self._spawn_food()
        self.score = 0
        self.steps = 0
        self.game_over = False
        self.total_reward = 0
        self.last_distance = self._get_distance_to_food()
        return self._get_state()

    def _spawn_food(self):
        head = self.snake[0]
        for _ in range(100):
            food = (random.randint(0, self.grid_size - 1), random.randint(0, self.grid_size - 1))
            if food not in self.snake:
                dist = abs(food[0] - head[0]) + abs(food[1] - head[1])
                if dist > 2:
                    return food
        return food

    def _get_distance_to_food(self):
        head = self.snake[0]
        return abs(head[0] - self.food[0]) + abs(head[1] - self.food[1])

    def _get_state(self):
        head = self.snake[0]
        state = []

        # 8 направлений
        directions = [(0, -1), (0, 1), (-1, 0), (1, 0),
                      (-1, -1), (1, -1), (-1, 1), (1, 1)]

        for dx, dy in directions:
            x, y = head[0] + dx, head[1] + dy

            # Стена
            state.append(1.0 if x < 0 or x >= self.grid_size or y < 0 or y >= self.grid_size else 0.0)

            # Еда
            state.append(1.0 if (x, y) == self.food else 0.0)

            # Хвост
            state.append(1.0 if (x, y) in self.snake else 0.0)

        return np.array(state, dtype=np.float32)

    def step(self, action):
        actions = [(0, -1), (0, 1), (-1, 0), (1, 0)]
        new_direction = actions[action]

        # Запрещаем разворот
        if not (self.direction[0] == -new_direction[0] and
                self.direction[1] == -new_direction[1]):
            self.direction = new_direction

        head = self.snake[0]
        new_head = (head[0] + self.direction[0], head[1] + self.direction[1])

        reward = 0

        # Проверка столкновения
        if (new_head[0] < 0 or new_head[0] >= self.grid_size or
                new_head[1] < 0 or new_head[1] >= self.grid_size or
                new_head in self.snake):
            self.game_over = True
            reward = -100
            self.total_reward += reward
            return self._get_state(), reward, self.game_over

        self.snake.insert(0, new_head)
        self.steps += 1

        # Проверка еды
        if new_head == self.food:
            self.score += 1
            reward = 200
            self.food = self._spawn_food()
            self.steps = 0
        else:
            self.snake.pop()

            # Награда за приближение к еде
            old_dist = self.last_distance
            new_dist = self._get_distance_to_food()
            self.last_distance = new_dist

            if new_dist < old_dist:
                reward += 15
            elif new_dist > old_dist:
                reward -= 8

            # Штраф за долгие блуждания
            if self.steps > 50 and self.score == 0:
                reward -= 2

            # Бонус за выживание
            if self.steps > 0 and self.steps % 20 == 0:
                reward += 3

        self.total_reward += reward

        # Максимальное количество шагов
        if self.steps > 200:
            self.game_over = True

        return self._get_state(), reward, self.game_over


# ========== УЛУЧШЕННЫЙ DQN АГЕНТ ==========
class DQNAgent:
    def __init__(self, state_size=24, action_size=4):
        self.state_size = state_size
        self.action_size = action_size

        # Основная и целевая сети
        self.model = DQN(state_size, 512, action_size)
        self.target_model = DQN(state_size, 512, action_size)
        self.target_model.load_state_dict(self.model.state_dict())

        self.optimizer = optim.Adam(self.model.parameters(), lr=LR)
        self.criterion = nn.SmoothL1Loss()  # Huber Loss

        # Буфер реплей
        self.memory = ReplayBuffer(MAX_MEMORY)

        # Параметры обучения
        self.epsilon = EPSILON_START
        self.epsilon_end = EPSILON_END
        self.epsilon_decay = EPSILON_DECAY

        self.update_counter = 0

    def act(self, state, training=True):
        if training and random.random() < self.epsilon:
            return random.randint(0, self.action_size - 1)

        with torch.no_grad():
            state_tensor = torch.FloatTensor(state).unsqueeze(0)
            q_values = self.model(state_tensor)
            return q_values.argmax().item()

    def remember(self, state, action, reward, next_state, done):
        self.memory.push(state, action, reward, next_state, done)

    def replay(self):
        if len(self.memory) < BATCH_SIZE:
            return None

        # Сэмплируем из буфера
        states, actions, rewards, next_states, dones = self.memory.sample(BATCH_SIZE)

        # Конвертируем в тензоры
        states = torch.FloatTensor(states)
        actions = torch.LongTensor(actions)
        rewards = torch.FloatTensor(rewards)
        next_states = torch.FloatTensor(next_states)
        dones = torch.FloatTensor(dones)

        # Текущие Q-значения
        current_q = self.model(states).gather(1, actions.unsqueeze(1)).squeeze()

        # Целевые Q-значения (Double DQN)
        with torch.no_grad():
            # Выбираем действия через основную сеть
            next_actions = self.model(next_states).argmax(1, keepdim=True)
            # Оцениваем через целевую сеть
            next_q = self.target_model(next_states).gather(1, next_actions).squeeze()
            target_q = rewards + (1 - dones) * GAMMA * next_q

        # Вычисляем loss
        loss = self.criterion(current_q, target_q)

        # Оптимизация
        self.optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
        self.optimizer.step()

        # Обновляем epsilon
        self.epsilon = max(self.epsilon_end, self.epsilon * self.epsilon_decay)

        return loss.item()

    def update_target(self):
        # Soft update
        for target_param, param in zip(self.target_model.parameters(), self.model.parameters()):
            target_param.data.copy_(TAU * param.data + (1 - TAU) * target_param.data)

    def save(self, path):
        torch.save({
            'model_state_dict': self.model.state_dict(),
            'target_state_dict': self.target_model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'epsilon': self.epsilon
        }, path)


# ========== ОБУЧЕНИЕ ==========
def train(episodes=300):
    agent = DQNAgent()
    game = SnakeGame()

    best_score = 0
    scores = []
    losses = []
    epsilons = []
    rewards_history = []

    print("🚀 Начинаем обучение с улучшенным DQN!")
    print(f"📊 Размер буфера: {MAX_MEMORY}")
    print(f"📊 Размер батча: {BATCH_SIZE}")
    print(f"🎯 Награда за еду: 200, Штраф за смерть: -100")
    print("=" * 60)

    for episode in range(episodes):
        state = game.reset()
        episode_loss = 0
        episode_reward = 0
        loss_count = 0

        while not game.game_over:
            action = agent.act(state)
            next_state, reward, done = game.step(action)

            agent.remember(state, action, reward, next_state, done)

            loss = agent.replay()
            if loss is not None:
                episode_loss += loss
                loss_count += 1

            state = next_state
            episode_reward += reward

        # Обновляем целевую сеть
        agent.update_counter += 1
        if agent.update_counter % UPDATE_EVERY == 0:
            agent.update_target()

        # Сохраняем статистику
        scores.append(game.score)
        epsilons.append(agent.epsilon)
        rewards_history.append(episode_reward)

        if loss_count > 0:
            losses.append(episode_loss / loss_count)
        else:
            losses.append(0)

        # Сохраняем лучшую модель
        if game.score > best_score:
            best_score = game.score
            agent.save('best_model.pt')
            print(f"🏆 НОВЫЙ РЕКОРД: {best_score} (эпизод {episode})")

        # Вывод статистики
        if episode % 10 == 0:
            avg_score = np.mean(scores[-10:]) if scores else 0
            avg_loss = np.mean(losses[-10:]) if losses else 0
            avg_reward = np.mean(rewards_history[-10:]) if rewards_history else 0

            print(f"📊 Эпизод {episode:4d} | "
                  f"Счет: {game.score:3d} | "
                  f"Ср. счет: {avg_score:5.1f} | "
                  f"Лучший: {best_score:3d} | "
                  f"Eps: {agent.epsilon:.4f} | "
                  f"Loss: {avg_loss:6.4f} | "
                  f"Reward: {avg_reward:7.1f}")

    print("=" * 60)
    print(f"✅ Обучение завершено!")
    print(f"🏆 Лучший счет: {best_score}")
    print(f"📊 Средний за 50 игр: {np.mean(scores[-50:]):.1f}")

    return agent, scores, losses, epsilons, rewards_history


# ========== СОХРАНЕНИЕ ДЛЯ ВЕБА ==========
def save_for_web(agent, scores, losses, epsilons, rewards):
    # Сохраняем модель
    torch.save(agent.model.state_dict(), 'model.pt')
    print("✅ model.pt сохранен")

    # Сохраняем конфиг
    config = {
        "input_size": 24,
        "hidden_size": 512,
        "output_size": 4,
        "grid_size": GRID_SIZE
    }
    with open('model_config.json', 'w') as f:
        json.dump(config, f, indent=2)
    print("✅ model_config.json сохранен")

    # Сохраняем историю обучения
    history = {
        "scores": scores,
        "losses": losses,
        "epsilons": epsilons,
        "rewards": rewards
    }
    with open('training_history.json', 'w') as f:
        json.dump(history, f)
    print("✅ training_history.json сохранен")

    # Конвертируем в ONNX
    model = DQN(24, 512, 4)
    model.load_state_dict(torch.load('model.pt'))
    model.eval()

    dummy_input = torch.randn(1, 24)
    torch.onnx.export(
        model,
        dummy_input,
        "model.onnx",
        export_params=True,
        opset_version=11,
        do_constant_folding=True,
        input_names=['input'],
        output_names=['output'],
        dynamic_axes={
            'input': {0: 'batch_size'},
            'output': {0: 'batch_size'}
        }
    )
    print("✅ model.onnx сохранен")


if __name__ == "__main__":
    agent, scores, losses, epsilons, rewards = train(episodes=300)
    save_for_web(agent, scores, losses, epsilons, rewards)
    print("\n🎉 Все готово для деплоя!")