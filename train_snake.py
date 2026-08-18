import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
import random
import json
from collections import deque
import os

# ========== НАСТРОЙКИ ==========
GRID_SIZE = 12  # УМЕНЬШИЛИ ПОЛЕ!
MAX_MEMORY = 100_000
BATCH_SIZE = 1024
LR = 0.001
GAMMA = 0.95
EPSILON = 1.0
EPSILON_DECAY = 0.995
MIN_EPSILON = 0.01
TARGET_UPDATE = 10


# ========== МОДЕЛЬ С VALUE HEAD ==========
class SnakeAI(nn.Module):
    def __init__(self, input_size=24, hidden_size=256, output_size=4):
        super().__init__()
        # Общая часть (shared layers)
        self.fc1 = nn.Linear(input_size, hidden_size)
        self.bn1 = nn.BatchNorm1d(hidden_size)
        self.fc2 = nn.Linear(hidden_size, hidden_size // 2)
        self.bn2 = nn.BatchNorm1d(hidden_size // 2)
        self.fc3 = nn.Linear(hidden_size // 2, hidden_size // 4)

        # Advantage head (для действий)
        self.advantage = nn.Linear(hidden_size // 4, output_size)

        # Value head (для оценки состояния) - КРИТИК!
        self.value = nn.Linear(hidden_size // 4, 1)

        self.relu = nn.ReLU()
        self.dropout = nn.Dropout(0.1)

    def forward(self, x):
        x = self.relu(self.bn1(self.fc1(x)))
        x = self.dropout(x)
        x = self.relu(self.bn2(self.fc2(x)))
        x = self.dropout(x)
        x = self.relu(self.fc3(x))

        advantage = self.advantage(x)
        value = self.value(x)

        # Q(s,a) = V(s) + (A(s,a) - mean(A(s,a)))
        q_values = value + advantage - advantage.mean(dim=1, keepdim=True)
        return q_values, value  # Возвращаем и Q-values, и Value


# ========== УЛУЧШЕННАЯ ИГРА ==========
class SnakeGame:
    def __init__(self):
        self.reset()

    def reset(self):
        center = GRID_SIZE // 2
        self.snake = [(center, center), (center - 1, center), (center - 2, center)]
        self.direction = (1, 0)
        self.food = self._spawn_food()
        self.score = 0
        self.steps = 0
        self.game_over = False
        self.consecutive_food = 0
        self.last_distance = self._get_distance_to_food()
        return self._get_state()

    def _spawn_food(self):
        head = self.snake[0]
        attempts = 0
        while attempts < 50:
            food = (random.randint(0, GRID_SIZE - 1), random.randint(0, GRID_SIZE - 1))
            if food not in self.snake:
                dist = abs(food[0] - head[0]) + abs(food[1] - head[1])
                if dist > 2:
                    return food
            attempts += 1
        return food

    def _get_distance_to_food(self):
        head = self.snake[0]
        return abs(head[0] - self.food[0]) + abs(head[1] - self.food[1])

    def _get_state(self):
        head = self.snake[0]
        state = []

        directions = [(0, -1), (0, 1), (-1, 0), (1, 0),
                      (-1, -1), (1, -1), (-1, 1), (1, 1)]

        for dx, dy in directions:
            x, y = head[0] + dx, head[1] + dy

            # Стена
            state.append(1 if x < 0 or x >= GRID_SIZE or y < 0 or y >= GRID_SIZE else 0)

            # Еда
            state.append(1 if (x, y) == self.food else 0)

            # Хвост
            state.append(1 if (x, y) in self.snake else 0)

        return np.array(state, dtype=np.float32)

    def step(self, action):
        actions = [(0, -1), (0, 1), (-1, 0), (1, 0)]
        new_direction = actions[action]

        if not (self.direction[0] == -new_direction[0] and
                self.direction[1] == -new_direction[1]):
            self.direction = new_direction

        head = self.snake[0]
        new_head = (head[0] + self.direction[0], head[1] + self.direction[1])

        reward = 0

        # Проверка столкновения
        if (new_head[0] < 0 or new_head[0] >= GRID_SIZE or
                new_head[1] < 0 or new_head[1] >= GRID_SIZE or
                new_head in self.snake):
            self.game_over = True
            reward = -50
            return self._get_state(), reward, self.game_over

        self.snake.insert(0, new_head)
        self.steps += 1

        # Награда за еду
        if new_head == self.food:
            self.score += 1
            reward = 100
            self.food = self._spawn_food()
            self.steps = 0
            self.consecutive_food += 1

            if self.consecutive_food > 3:
                reward += 20
        else:
            self.snake.pop()
            self.consecutive_food = 0

            # Награда за приближение к еде
            old_dist = self.last_distance
            new_dist = self._get_distance_to_food()
            self.last_distance = new_dist

            if new_dist < old_dist:
                reward += 10  # Увеличил награду за приближение
            else:
                reward -= 5

            # Штраф за блуждания (меньше на маленьком поле)
            if self.steps > 50 and self.score == 0:
                reward -= 3

            # Бонус за выживание
            if self.steps > 0 and self.steps % 30 == 0:
                reward += 5

        return self._get_state(), reward, self.game_over


# ========== УЛУЧШЕННЫЙ АГЕНТ ==========
class DQNAgent:
    def __init__(self, input_size=24, hidden_size=256, output_size=4):
        self.model = SnakeAI(input_size, hidden_size, output_size)
        self.target_model = SnakeAI(input_size, hidden_size, output_size)
        self.target_model.load_state_dict(self.model.state_dict())

        self.optimizer = optim.Adam(self.model.parameters(), lr=LR)
        self.criterion = nn.MSELoss()
        self.memory = deque(maxlen=MAX_MEMORY)
        self.epsilon = EPSILON
        self.gamma = GAMMA
        self.update_counter = 0

    def remember(self, state, action, reward, next_state, done):
        self.memory.append((state, action, reward, next_state, done))

    def act(self, state):
        if random.random() < self.epsilon:
            return random.randint(0, 3)

        with torch.no_grad():
            state_tensor = torch.FloatTensor(state).unsqueeze(0)
            q_values, _ = self.model(state_tensor)
            return q_values.argmax().item()

    def replay(self):
        if len(self.memory) < BATCH_SIZE:
            return

        batch = random.sample(self.memory, BATCH_SIZE)
        states, actions, rewards, next_states, dones = zip(*batch)

        states = torch.FloatTensor(np.array(states))
        actions = torch.LongTensor(np.array(actions))
        rewards = torch.FloatTensor(np.array(rewards))
        next_states = torch.FloatTensor(np.array(next_states))
        dones = torch.FloatTensor(np.array(dones))

        # Получаем Q-values и Value
        current_q, current_v = self.model(states)

        with torch.no_grad():
            # Double DQN для Q-values
            next_q, _ = self.model(next_states)
            next_actions = next_q.argmax(1, keepdim=True)

            target_q, _ = self.target_model(next_states)
            target_q_values = target_q.gather(1, next_actions).squeeze()

            # Вычисляем target для Value (критика)
            # V_target = reward + gamma * V_next
            _, next_v = self.target_model(next_states)
            target_v = rewards + (1 - dones) * self.gamma * next_v.squeeze()

        # ====== TWO LOSSES ======
        # 1. Q-Loss (для actor)
        current_q_values = current_q.gather(1, actions.unsqueeze(1)).squeeze()
        q_loss = self.criterion(current_q_values, target_q_values)

        # 2. Value Loss (для critic)
        current_v_values = current_v.squeeze()
        v_loss = self.criterion(current_v_values, target_v)

        # 3. Combined Loss
        total_loss = q_loss + 0.5 * v_loss  # Можно регулировать вес

        # Оптимизация
        self.optimizer.zero_grad()
        total_loss.backward()
        torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
        self.optimizer.step()

        # Уменьшаем epsilon
        self.epsilon = max(MIN_EPSILON, self.epsilon * EPSILON_DECAY)

        return {
            'q_loss': q_loss.item(),
            'v_loss': v_loss.item(),
            'total_loss': total_loss.item()
        }

    def update_target_model(self):
        self.target_model.load_state_dict(self.model.state_dict())


# ========== ОБУЧЕНИЕ ==========
def train(episodes=1000):
    agent = DQNAgent()
    game = SnakeGame()
    best_score = 0
    scores = []
    losses = []
    recent_scores = deque(maxlen=50)

    print("🚀 Начинаем обучение на поле 12x12!")
    print(f"📊 Размер памяти: {MAX_MEMORY}")
    print(f"📊 Размер батча: {BATCH_SIZE}")
    print(f"🎯 Награда за еду: 100, Штраф за смерть: -50")

    for episode in range(episodes):
        state = game.reset()
        total_reward = 0
        episode_losses = []

        while not game.game_over:
            action = agent.act(state)
            next_state, reward, done = game.step(action)
            agent.remember(state, action, reward, next_state, done)

            # Обучение на батче
            loss_info = agent.replay()
            if loss_info:
                episode_losses.append(loss_info)

            state = next_state
            total_reward += reward

            # Ранний выход
            if game.steps > 300:
                game.game_over = True
                break

        # Обновляем target модель
        agent.update_counter += 1
        if agent.update_counter % TARGET_UPDATE == 0:
            agent.update_target_model()

        # Сохраняем лучшую модель
        if game.score > best_score:
            best_score = game.score
            torch.save(agent.model.state_dict(), 'best_model.pt')
            print(f"🏆 НОВЫЙ РЕКОРД: {best_score} (эпизод {episode})")

        recent_scores.append(game.score)
        scores.append(game.score)

        # Сохраняем потери
        if episode_losses:
            avg_losses = {
                'q_loss': np.mean([l['q_loss'] for l in episode_losses]),
                'v_loss': np.mean([l['v_loss'] for l in episode_losses]),
                'total_loss': np.mean([l['total_loss'] for l in episode_losses])
            }
            losses.append(avg_losses)

        # Статистика каждые 10 эпизодов
        if episode % 10 == 0:
            avg_score = np.mean(recent_scores) if recent_scores else 0
            max_recent = max(recent_scores) if recent_scores else 0
            avg_q_loss = np.mean([l['q_loss'] for l in losses[-10:]]) if losses else 0
            avg_v_loss = np.mean([l['v_loss'] for l in losses[-10:]]) if losses else 0

            print(f"📊 Эпизод {episode:4d} | Счет: {game.score:3d} | "
                  f"Ср: {avg_score:5.1f} | Луч: {max_recent:3d} | "
                  f"Eps: {agent.epsilon:.3f} | "
                  f"Q-Loss: {avg_q_loss:6.3f} | V-Loss: {avg_v_loss:6.3f}")

    print(f"\n✅ Обучение завершено!")
    print(f"🏆 Лучший счет: {best_score}")
    print(f"📊 Средний за последние 50: {np.mean(recent_scores):.1f}")

    return agent


# ========== СОХРАНЕНИЕ ==========
def save_model_for_web(agent):
    if os.path.exists('best_model.pt'):
        model = SnakeAI(24, 256, 4)
        model.load_state_dict(torch.load('best_model.pt'))
    else:
        model = agent.model

    torch.save(model.state_dict(), 'model.pt')
    print("✅ model.pt сохранен")

    config = {
        "input_size": 24,
        "hidden_size": 256,
        "output_size": 4,
        "grid_size": 12
    }
    with open('model_config.json', 'w') as f:
        json.dump(config, f, indent=2)
    print("✅ model_config.json сохранен")

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
    agent = train(episodes=300)  # Меньше эпизодов из-за маленького поля
    save_model_for_web(agent)
    print("\n🎉 Все готово для деплоя!")