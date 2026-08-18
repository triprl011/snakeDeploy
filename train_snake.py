import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
import random
import json
from collections import deque
import os

# ========== НАСТРОЙКИ ==========
GRID_SIZE = 20
MAX_MEMORY = 200_000  # Увеличил память
BATCH_SIZE = 2048  # Увеличил батч
LR = 0.001
GAMMA = 0.95  # Улучшил дисконт
EPSILON = 1.0  # Начинаем с полной случайности
EPSILON_DECAY = 0.997  # Медленнее уменьшаем
MIN_EPSILON = 0.01


# ========== УЛУЧШЕННАЯ МОДЕЛЬ ==========
class SnakeAI(nn.Module):
    def __init__(self, input_size=24, hidden_size=512, output_size=4):
        super().__init__()
        self.fc1 = nn.Linear(input_size, hidden_size)
        self.bn1 = nn.BatchNorm1d(hidden_size)
        self.fc2 = nn.Linear(hidden_size, hidden_size // 2)
        self.bn2 = nn.BatchNorm1d(hidden_size // 2)
        self.fc3 = nn.Linear(hidden_size // 2, hidden_size // 4)
        self.fc4 = nn.Linear(hidden_size // 4, output_size)
        self.relu = nn.ReLU()
        self.dropout = nn.Dropout(0.1)

    def forward(self, x):
        x = self.relu(self.bn1(self.fc1(x)))
        x = self.dropout(x)
        x = self.relu(self.bn2(self.fc2(x)))
        x = self.dropout(x)
        x = self.relu(self.fc3(x))
        return self.fc4(x)


# ========== УЛУЧШЕННАЯ ИГРА ==========
class SnakeGame:
    def __init__(self):
        self.reset()

    def reset(self):
        # Начинаем с середины
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
        # Спавним еду НЕ рядом с головой
        head = self.snake[0]
        attempts = 0
        while attempts < 100:
            food = (random.randint(0, GRID_SIZE - 1), random.randint(0, GRID_SIZE - 1))
            if food not in self.snake:
                # Проверяем, что еда не слишком близко к голове
                dist = abs(food[0] - head[0]) + abs(food[1] - head[1])
                if dist > 2:  # Не ближе 2 клеток
                    return food
            attempts += 1
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
            state.append(1 if x < 0 or x >= GRID_SIZE or y < 0 or y >= GRID_SIZE else 0)

            # Еда
            state.append(1 if (x, y) == self.food else 0)

            # Хвост
            state.append(1 if (x, y) in self.snake else 0)

        return np.array(state, dtype=np.float32)

    def step(self, action):
        # Преобразуем действие в направление
        actions = [(0, -1), (0, 1), (-1, 0), (1, 0)]
        new_direction = actions[action]

        # Запрещаем разворот
        if not (self.direction[0] == -new_direction[0] and
                self.direction[1] == -new_direction[1]):
            self.direction = new_direction

        # Двигаем змейку
        head = self.snake[0]
        new_head = (head[0] + self.direction[0], head[1] + self.direction[1])

        # ====== ВЫЧИСЛЯЕМ НАГРАДУ ======
        reward = 0

        # Проверка столкновения
        if (new_head[0] < 0 or new_head[0] >= GRID_SIZE or
                new_head[1] < 0 or new_head[1] >= GRID_SIZE or
                new_head in self.snake):
            self.game_over = True
            reward = -50  # Большой штраф за смерть
            return self._get_state(), reward, self.game_over

        self.snake.insert(0, new_head)
        self.steps += 1

        # ====== НАГРАДА ЗА ЕДУ ======
        if new_head == self.food:
            self.score += 1
            reward = 100  # Большая награда
            self.food = self._spawn_food()
            self.steps = 0
            self.consecutive_food += 1

            # Бонус за серию
            if self.consecutive_food > 3:
                reward += 20  # Бонус за комбо
        else:
            self.snake.pop()
            self.consecutive_food = 0

            # ====== НАГРАДА ЗА ПРИБЛИЖЕНИЕ К ЕДЕ ======
            old_dist = self.last_distance
            new_dist = self._get_distance_to_food()
            self.last_distance = new_dist

            if new_dist < old_dist:
                reward += 8  # Приблизился к еде
            else:
                reward -= 4  # Отдалился от еды

            # ====== ШТРАФ ЗА БЛУЖДАНИЯ ======
            if self.steps > 100 and self.score == 0:
                reward -= 2

            # ====== ШТРАФ ЗА ПОВТОРЕНИЕ МАРШРУТА ======
            if len(self.snake) > 10:
                # Проверяем, не ходим ли по кругу
                if self.snake[0] in self.snake[4:]:
                    reward -= 5

        # ====== БОНУС ЗА ВЫЖИВАНИЕ ======
        if self.steps > 0 and self.steps % 50 == 0:
            reward += 3  # Бонус за долгую жизнь

        return self._get_state(), reward, self.game_over


# ========== УЛУЧШЕННЫЙ АГЕНТ ==========
class DQNAgent:
    def __init__(self, input_size=24, hidden_size=512, output_size=4):
        self.model = SnakeAI(input_size, hidden_size, output_size)
        self.target_model = SnakeAI(input_size, hidden_size, output_size)
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
            q_values = self.model(state_tensor)
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

        # Double DQN
        with torch.no_grad():
            # Выбираем действие через основную модель
            next_actions = self.model(next_states).argmax(1, keepdim=True)
            # Оцениваем через target модель
            next_q = self.target_model(next_states).gather(1, next_actions).squeeze()
            target_q = rewards + (1 - dones) * self.gamma * next_q

        current_q = self.model(states).gather(1, actions.unsqueeze(1)).squeeze()

        loss = self.criterion(current_q, target_q)
        self.optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)  # Обрезка градиентов
        self.optimizer.step()

        self.epsilon = max(MIN_EPSILON, self.epsilon * EPSILON_DECAY)

    def update_target_model(self):
        self.target_model.load_state_dict(self.model.state_dict())
        print("🔄 Target модель обновлена")


# ========== ОБУЧЕНИЕ ==========
def train(episodes=1000):
    agent = DQNAgent()
    game = SnakeGame()
    best_score = 0
    scores = []
    recent_scores = deque(maxlen=50)

    print("🚀 Начинаем улучшенное обучение...")
    print(f"📊 Размер памяти: {MAX_MEMORY}")
    print(f"📊 Размер батча: {BATCH_SIZE}")

    for episode in range(episodes):
        state = game.reset()
        total_reward = 0
        episode_score = 0

        while not game.game_over:
            action = agent.act(state)
            next_state, reward, done = game.step(action)
            agent.remember(state, action, reward, next_state, done)
            agent.replay()
            state = next_state
            total_reward += reward
            episode_score = game.score

            # Ранний выход для обучения
            if game.steps > 500:  # Если слишком долго - завершаем
                game.game_over = True
                break

        # Обновляем target модель чаще
        agent.update_counter += 1
        if agent.update_counter % 10 == 0:
            agent.update_target_model()

        # Сохраняем лучшую модель
        if game.score > best_score:
            best_score = game.score
            torch.save(agent.model.state_dict(), 'best_model.pt')
            print(f"🏆 НОВЫЙ РЕКОРД: {best_score} (эпизод {episode})")

        recent_scores.append(game.score)
        scores.append(game.score)

        # Статистика каждые 10 эпизодов
        if episode % 10 == 0:
            avg_score = np.mean(recent_scores) if recent_scores else 0
            max_recent = max(recent_scores) if recent_scores else 0
            print(f"📊 Эпизод {episode:4d} | Счет: {game.score:3d} | "
                  f"Средний: {avg_score:5.1f} | Лучший: {max_recent:3d} | "
                  f"Epsilon: {agent.epsilon:.3f} | Награда: {total_reward:6.1f}")

    print(f"\n✅ Обучение завершено!")
    print(f"🏆 Лучший счет: {best_score}")
    print(f"📊 Средний за последние 50: {np.mean(recent_scores):.1f}")

    return agent


# ========== СОХРАНЕНИЕ ==========
def save_model_for_web(agent):
    # Сохраняем лучшую модель
    if os.path.exists('best_model.pt'):
        model = SnakeAI(24, 512, 4)
        model.load_state_dict(torch.load('best_model.pt'))
    else:
        model = agent.model

    # Сохраняем PyTorch
    torch.save(model.state_dict(), 'model.pt')
    print("✅ model.pt сохранен")

    # Сохраняем конфиг
    config = {
        "input_size": 24,
        "hidden_size": 512,
        "output_size": 4
    }
    with open('model_config.json', 'w') as f:
        json.dump(config, f, indent=2)
    print("✅ model_config.json сохранен")

    # Конвертация в ONNX
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


# ========== ЗАПУСК ==========
if __name__ == "__main__":
    # Обучение
    agent = train(episodes=500)  # 500 эпизодов достаточно

    # Сохранение
    save_model_for_web(agent)

    print("\n🎉 Все файлы готовы для деплоя!")
    print("📦 Файлы:")
    print("  - model.onnx")
    print("  - model.pt")
    print("  - model_config.json")