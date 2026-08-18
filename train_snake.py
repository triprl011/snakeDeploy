import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
import random
import json
from collections import deque, namedtuple
import os
import math

# ========== НАСТРОЙКИ ==========
GRID_SIZE = 12
STATE_SIZE = 24
ACTION_SIZE = 4

# Параметры Rainbow
BUFFER_SIZE = 200_000
BATCH_SIZE = 512
LR = 0.00025
GAMMA = 0.99
TAU = 0.005  # Soft update
MULTI_STEP = 3  # N-step returns
ATOMS = 51  # Распределение
V_MIN = -100
V_MAX = 400
NOISY_STD = 0.1

# Обучение
EPISODES = 500
UPDATE_EVERY = 4
TARGET_UPDATE = 100
MIN_REPLAY_SIZE = 1000
ALPHA = 0.6  # Приоритеты
BETA = 0.4
BETA_INCREMENT = 0.001


# ========== NOISY LAYER ==========
class NoisyLinear(nn.Module):
    def __init__(self, in_features, out_features, std_init=0.5):
        super().__init__()
        self.in_features = in_features
        self.out_features = out_features
        self.std_init = std_init

        self.weight_mu = nn.Parameter(torch.empty(out_features, in_features))
        self.weight_sigma = nn.Parameter(torch.empty(out_features, in_features))
        self.bias_mu = nn.Parameter(torch.empty(out_features))
        self.bias_sigma = nn.Parameter(torch.empty(out_features))

        self.register_buffer('weight_epsilon', torch.empty(out_features, in_features))
        self.register_buffer('bias_epsilon', torch.empty(out_features))

        self.reset_parameters()
        self.reset_noise()

    def reset_parameters(self):
        mu_range = 1 / math.sqrt(self.in_features)
        self.weight_mu.data.uniform_(-mu_range, mu_range)
        self.weight_sigma.data.fill_(self.std_init / math.sqrt(self.in_features))
        self.bias_mu.data.uniform_(-mu_range, mu_range)
        self.bias_sigma.data.fill_(self.std_init / math.sqrt(self.out_features))

    def reset_noise(self):
        self.weight_epsilon.normal_()
        self.bias_epsilon.normal_()

    def forward(self, x):
        if self.training:
            weight = self.weight_mu + self.weight_sigma * self.weight_epsilon
            bias = self.bias_mu + self.bias_sigma * self.bias_epsilon
        else:
            weight = self.weight_mu
            bias = self.bias_mu
        return torch.nn.functional.linear(x, weight, bias)


# ========== DUELING NETWORK ==========
class RainbowDQN(nn.Module):
    def __init__(self, state_size, action_size, atoms, v_min, v_max):
        super().__init__()
        self.action_size = action_size
        self.atoms = atoms
        self.v_min = v_min
        self.v_max = v_max

        # Общая сеть
        self.fc1 = NoisyLinear(state_size, 512)
        self.fc2 = NoisyLinear(512, 256)

        # Value stream
        self.value_fc = NoisyLinear(256, 128)
        self.value = NoisyLinear(128, atoms)

        # Advantage stream
        self.adv_fc = NoisyLinear(256, 128)
        self.advantage = NoisyLinear(128, action_size * atoms)

    def forward(self, x):
        x = torch.relu(self.fc1(x))
        x = torch.relu(self.fc2(x))

        # Value
        v = torch.relu(self.value_fc(x))
        v = self.value(v).view(-1, 1, self.atoms)

        # Advantage
        a = torch.relu(self.adv_fc(x))
        a = self.advantage(a).view(-1, self.action_size, self.atoms)

        # Суммируем
        q = v + a - a.mean(dim=1, keepdim=True)

        # Softmax по распределению
        q = torch.softmax(q, dim=2)
        return q

    def reset_noise(self):
        for module in self.modules():
            if isinstance(module, NoisyLinear):
                module.reset_noise()

    def get_q_values(self, x):
        dist = self.forward(x)
        support = torch.linspace(self.v_min, self.v_max, self.atoms).to(x.device)
        q_values = (dist * support).sum(dim=2)
        return q_values


# ========== PRIORITIZED REPLAY BUFFER ==========
class PrioritizedReplayBuffer:
    def __init__(self, capacity, alpha=0.6, beta=0.4):
        self.capacity = capacity
        self.alpha = alpha
        self.beta = beta
        self.buffer = []
        self.priorities = np.zeros(capacity, dtype=np.float32)
        self.position = 0
        self.size = 0

    def push(self, state, action, reward, next_state, done):
        max_priority = self.priorities.max() if self.size > 0 else 1.0

        if self.size < self.capacity:
            self.buffer.append((state, action, reward, next_state, done))
        else:
            self.buffer[self.position] = (state, action, reward, next_state, done)

        self.priorities[self.position] = max_priority
        self.position = (self.position + 1) % self.capacity
        self.size = min(self.size + 1, self.capacity)

    def sample(self, batch_size):
        if self.size == 0:
            return None

        probs = self.priorities[:self.size] ** self.alpha
        probs /= probs.sum()

        indices = np.random.choice(self.size, batch_size, p=probs)
        samples = [self.buffer[idx] for idx in indices]

        weights = (self.size * probs[indices]) ** (-self.beta)
        weights /= weights.max()

        states, actions, rewards, next_states, dones = zip(*samples)

        return {
            'states': np.array(states, dtype=np.float32),
            'actions': np.array(actions, dtype=np.int64),
            'rewards': np.array(rewards, dtype=np.float32),
            'next_states': np.array(next_states, dtype=np.float32),
            'dones': np.array(dones, dtype=np.float32),
            'indices': indices,
            'weights': np.array(weights, dtype=np.float32)
        }

    def update_priorities(self, indices, td_errors):
        for idx, td_error in zip(indices, td_errors):
            self.priorities[idx] = abs(td_error) + 1e-6

    def __len__(self):
        return self.size


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
        directions = [(0, -1), (0, 1), (-1, 0), (1, 0),
                      (-1, -1), (1, -1), (-1, 1), (1, 1)]

        for dx, dy in directions:
            x, y = head[0] + dx, head[1] + dy
            state.append(1.0 if x < 0 or x >= self.grid_size or y < 0 or y >= self.grid_size else 0.0)
            state.append(1.0 if (x, y) == self.food else 0.0)
            state.append(1.0 if (x, y) in self.snake else 0.0)

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

        if (new_head[0] < 0 or new_head[0] >= self.grid_size or
                new_head[1] < 0 or new_head[1] >= self.grid_size or
                new_head in self.snake):
            self.game_over = True
            reward = -50
            self.total_reward += reward
            return self._get_state(), reward, self.game_over

        self.snake.insert(0, new_head)
        self.steps += 1

        if new_head == self.food:
            self.score += 1
            reward = 100
            self.food = self._spawn_food()
            self.steps = 0
        else:
            self.snake.pop()

            old_dist = self.last_distance
            new_dist = self._get_distance_to_food()
            self.last_distance = new_dist

            if new_dist < old_dist:
                reward += 5
            else:
                reward -= 3

            if self.steps > 50 and self.score == 0:
                reward -= 1

            if self.steps > 0 and self.steps % 20 == 0:
                reward += 2

        self.total_reward += reward

        if self.steps > 200:
            self.game_over = True

        return self._get_state(), reward, self.game_over


# ========== RAINBOW AGENT ==========
class RainbowAgent:
    def __init__(self):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        self.model = RainbowDQN(STATE_SIZE, ACTION_SIZE, ATOMS, V_MIN, V_MAX).to(self.device)
        self.target_model = RainbowDQN(STATE_SIZE, ACTION_SIZE, ATOMS, V_MIN, V_MAX).to(self.device)
        self.target_model.load_state_dict(self.model.state_dict())

        self.optimizer = optim.Adam(self.model.parameters(), lr=LR, eps=1.5e-4)

        self.memory = PrioritizedReplayBuffer(BUFFER_SIZE, ALPHA, BETA)

        self.step_count = 0
        self.episode_count = 0

        # Multi-step
        self.n_step_buffer = deque(maxlen=MULTI_STEP)

        # Statistics
        self.losses = []
        self.q_values = []

        print(f"🌈 Rainbow DQN на {self.device}")
        print(f"📊 Размер буфера: {BUFFER_SIZE}")
        print(f"📊 Размер батча: {BATCH_SIZE}")
        print(f"🎯 Multi-step: {MULTI_STEP}")
        print(f"📊 Атомы распределения: {ATOMS}")

    def act(self, state, training=True):
        self.model.eval()
        with torch.no_grad():
            state_tensor = torch.FloatTensor(state).unsqueeze(0).to(self.device)
            q_values = self.model.get_q_values(state_tensor)
            action = q_values.argmax().item()

        if training:
            self.model.train()
        return action

    def remember(self, state, action, reward, next_state, done):
        self.memory.push(state, action, reward, next_state, done)

    def learn(self):
        if len(self.memory) < MIN_REPLAY_SIZE:
            return None

        self.step_count += 1
        if self.step_count % UPDATE_EVERY != 0:
            return None

        # Сэмплируем
        batch = self.memory.sample(BATCH_SIZE)
        if batch is None:
            return None

        states = torch.FloatTensor(batch['states']).to(self.device)
        actions = torch.LongTensor(batch['actions']).to(self.device)
        rewards = torch.FloatTensor(batch['rewards']).to(self.device)
        next_states = torch.FloatTensor(batch['next_states']).to(self.device)
        dones = torch.FloatTensor(batch['dones']).to(self.device)
        weights = torch.FloatTensor(batch['weights']).to(self.device)
        indices = batch['indices']

        # Distributional DQN
        support = torch.linspace(V_MIN, V_MAX, ATOMS).to(self.device)
        delta = (V_MAX - V_MIN) / (ATOMS - 1)

        # Текущее распределение
        dist = self.model(states)
        dist = dist[range(BATCH_SIZE), actions]

        # Целевое распределение
        with torch.no_grad():
            next_dist = self.target_model(next_states)

            # Double DQN для выбора действия
            next_q = self.model.get_q_values(next_states)
            next_actions = next_q.argmax(dim=1)

            next_dist = next_dist[range(BATCH_SIZE), next_actions]

            # Multi-step returns
            n_step_rewards = rewards
            for n in range(1, MULTI_STEP):
                # Здесь нужен n-step буфер
                pass

            # Смещаем распределение
            target_z = rewards.unsqueeze(1) + (1 - dones).unsqueeze(1) * GAMMA * support.unsqueeze(0)
            target_z = torch.clamp(target_z, V_MIN, V_MAX)

            # Проекция на атомы
            b = (target_z - V_MIN) / delta
            l = b.floor().long()
            u = b.ceil().long()

            # Создаем целевое распределение
            target_dist = torch.zeros_like(next_dist)
            for i in range(BATCH_SIZE):
                target_dist[i].index_add_(0, l[i], next_dist[i] * (u[i] - b[i]))
                target_dist[i].index_add_(0, u[i], next_dist[i] * (b[i] - l[i]))

        # Вычисляем loss
        loss = -(target_dist * torch.log(dist + 1e-8)).sum(dim=1)
        loss = (loss * weights).mean()

        # Оптимизация
        self.optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
        self.optimizer.step()

        # Сбрасываем шум
        self.model.reset_noise()
        self.target_model.reset_noise()

        # Обновляем приоритеты
        with torch.no_grad():
            td_errors = (target_dist * support.unsqueeze(0)).sum(dim=1) - (dist * support.unsqueeze(0)).sum(dim=1)
            td_errors = td_errors.cpu().numpy()
            self.memory.update_priorities(indices, td_errors)

        # Обновляем target сеть
        if self.step_count % TARGET_UPDATE == 0:
            self.target_model.load_state_dict(self.model.state_dict())

        # Сохраняем статистику
        self.losses.append(loss.item())

        return loss.item()

    def reset_noise(self):
        self.model.reset_noise()
        self.target_model.reset_noise()


# ========== ОБУЧЕНИЕ ==========
def train():
    agent = RainbowAgent()
    game = SnakeGame()

    best_score = 0
    scores = []
    rewards_history = []
    losses_history = []

    print("=" * 60)
    print("🌈 НАЧАЛО ОБУЧЕНИЯ RAINBOW DQN")
    print(f"📊 Эпизодов: {EPISODES}")
    print(f"🎯 Награда за еду: 100, Штраф за смерть: -50")
    print("=" * 60)

    for episode in range(EPISODES):
        state = game.reset()
        episode_reward = 0
        episode_losses = []

        while not game.game_over:
            action = agent.act(state)
            next_state, reward, done = game.step(action)

            agent.remember(state, action, reward, next_state, done)
            loss = agent.learn()

            if loss is not None:
                episode_losses.append(loss)

            state = next_state
            episode_reward += reward

        agent.episode_count += 1

        # Сброс шума после эпизода
        agent.reset_noise()

        scores.append(game.score)
        rewards_history.append(episode_reward)

        if episode_losses:
            avg_loss = np.mean(episode_losses)
            losses_history.append(avg_loss)
        else:
            losses_history.append(0)

        if game.score > best_score:
            best_score = game.score
            torch.save(agent.model.state_dict(), 'best_model.pt')
            print(f"🏆 НОВЫЙ РЕКОРД: {best_score} (эпизод {episode})")

        # Статистика
        if episode % 10 == 0:
            avg_score = np.mean(scores[-10:]) if scores else 0
            avg_reward = np.mean(rewards_history[-10:]) if rewards_history else 0
            avg_loss = np.mean(losses_history[-10:]) if losses_history else 0

            print(f"📊 Эпизод {episode:4d} | "
                  f"Счет: {game.score:3d} | "
                  f"Ср. счет: {avg_score:5.1f} | "
                  f"Лучший: {best_score:3d} | "
                  f"Награда: {avg_reward:7.1f} | "
                  f"Loss: {avg_loss:6.4f} | "
                  f"Буфер: {len(agent.memory):6d}")

    print("=" * 60)
    print(f"✅ ОБУЧЕНИЕ ЗАВЕРШЕНО!")
    print(f"🏆 Лучший счет: {best_score}")
    print(f"📊 Средний за 50 игр: {np.mean(scores[-50:]):.1f}")

    return agent, scores, losses_history, rewards_history


# ========== СОХРАНЕНИЕ ==========
def save_for_web(agent, scores, losses, rewards):
    # Сохраняем модель
    torch.save(agent.model.state_dict(), 'model.pt')
    print("✅ model.pt сохранен")

    # Сохраняем конфиг
    config = {
        "input_size": STATE_SIZE,
        "hidden_size": 512,
        "output_size": ACTION_SIZE,
        "grid_size": GRID_SIZE,
        "rainbow": True,
        "atoms": ATOMS
    }
    with open('model_config.json', 'w') as f:
        json.dump(config, f, indent=2)
    print("✅ model_config.json сохранен")

    # Сохраняем историю
    history = {
        "scores": scores,
        "losses": losses,
        "rewards": rewards,
        "epsilons": [0.01] * len(scores)  # No epsilon in Rainbow
    }
    with open('training_history.json', 'w') as f:
        json.dump(history, f)
    print("✅ training_history.json сохранен")

    # Конвертируем в ONNX
    class Wrapper(nn.Module):
        def forward(self, x):
            return agent.model.get_q_values(x)

    wrapper = Wrapper()
    wrapper.load_state_dict(agent.model.state_dict())
    wrapper.eval()

    dummy_input = torch.randn(1, STATE_SIZE)
    torch.onnx.export(
        wrapper,
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
    agent, scores, losses, rewards = train()
    save_for_web(agent, scores, losses, rewards)
    print("\n🎉 Все готово для деплоя!")